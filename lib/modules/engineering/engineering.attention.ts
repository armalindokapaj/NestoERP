import type { Prisma } from "@prisma/client";

import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { notifyEngineering } from "./engineering.notify";
import { DOCUMENT_RECORD, MODULE, RFI_RECORD, SUBMITTAL_RECORD } from "./engineering.permissions";
import { resolveEngineeringSettings } from "./engineering.settings";
import { dateLabel, dateOf } from "./engineering.shared";

/**
 * What engineering asks people to look at, and when it reminds them
 * (PRD #46 §95, §107, §195-§199).
 *
 * Attention is a condition that holds right now: an RFI waiting for its
 * assignee, an overdue answer or review, a submittal sent back for revision.
 * The reconciliation resolves it the moment the condition ends. Reminders go
 * once per record per due date — moving the date starts a new one, running the
 * job again does not (§196).
 */

const LIVE_PROJECT = { archivedAt: null, status: { not: "ARCHIVED" as const } };
const LIMIT = 500;

async function todayFor(companyId: string, now: Date) {
  const settings = await resolveEngineeringSettings(companyId);
  return { settings, today: localDate(now, settings.timezone) };
}

const startOf = (date: string) => new Date(`${date}T00:00:00.000Z`);
const endOf = (date: string) => new Date(`${date}T23:59:59.999Z`);

const RFI_ROW = { id: true, projectId: true, rfiNumber: true, subject: true, priority: true, assignedToMemberId: true, createdByMemberId: true, raisedByMemberId: true, dueAt: true, status: true, openedAt: true, updatedAt: true, project: { select: { name: true, projectManagerMemberId: true } } } satisfies Prisma.RfiSelect;
export type RfiAttentionRow = Prisma.RfiGetPayload<{ select: typeof RFI_ROW }>;

/** RFIs waiting on an answer past their due date (§95). */
export async function overdueRfis(companyId: string, now: Date, rfiId?: string): Promise<RfiAttentionRow[]> {
  const { today } = await todayFor(companyId, now);
  return prisma.rfi.findMany({ where: { companyId, status: { in: ["OPEN", "CLARIFICATION_REQUIRED"] }, dueAt: { lt: startOf(today) }, project: { is: LIVE_PROJECT }, ...(rfiId ? { id: rfiId } : {}) }, orderBy: { dueAt: "asc" }, take: LIMIT, select: RFI_ROW });
}

/** RFIs waiting on their assignee, due or not (§95). */
export async function rfisAwaitingResponse(companyId: string, rfiId?: string): Promise<RfiAttentionRow[]> {
  return prisma.rfi.findMany({ where: { companyId, status: { in: ["OPEN", "CLARIFICATION_REQUIRED"] }, assignedToMemberId: { not: null }, project: { is: LIVE_PROJECT }, ...(rfiId ? { id: rfiId } : {}) }, orderBy: { dueAt: "asc" }, take: LIMIT, select: RFI_ROW });
}

const SUBMITTAL_ROW = { id: true, projectId: true, submittalNumber: true, title: true, status: true, assignedReviewerMemberId: true, createdByMemberId: true, dueAt: true, updatedAt: true, currentRevision: { select: { id: true, submittedByMemberId: true, reviewedAt: true } }, project: { select: { name: true, projectManagerMemberId: true } } } satisfies Prisma.TechnicalSubmittalSelect;
export type SubmittalAttentionRow = Prisma.TechnicalSubmittalGetPayload<{ select: typeof SUBMITTAL_ROW }>;

/** Submittals with the reviewer past their review date (§107). */
export async function overdueSubmittalReviews(companyId: string, now: Date, submittalId?: string): Promise<SubmittalAttentionRow[]> {
  const { today } = await todayFor(companyId, now);
  return prisma.technicalSubmittal.findMany({ where: { companyId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, dueAt: { lt: startOf(today) }, project: { is: LIVE_PROJECT }, ...(submittalId ? { id: submittalId } : {}) }, take: LIMIT, select: SUBMITTAL_ROW });
}

/** Submittals sent back for a new revision, until one is added and submitted (§107). */
export async function submittalsNeedingRevision(companyId: string, submittalId?: string): Promise<SubmittalAttentionRow[]> {
  return prisma.technicalSubmittal.findMany({ where: { companyId, status: "REVISION_REQUIRED", project: { is: LIVE_PROJECT }, ...(submittalId ? { id: submittalId } : {}) }, take: LIMIT, select: SUBMITTAL_ROW });
}

const DOCUMENT_ROW = { id: true, projectId: true, documentNumber: true, title: true, reviewerMemberId: true, reviewDueAt: true, currentRevision: { select: { id: true, revisionCode: true } }, project: { select: { name: true, projectManagerMemberId: true } } } satisfies Prisma.EngineeringDocumentSelect;
export type DocumentAttentionRow = Prisma.EngineeringDocumentGetPayload<{ select: typeof DOCUMENT_ROW }>;

/** Engineering documents under review past their review date (§197). */
export async function overdueDocumentReviews(companyId: string, now: Date, documentId?: string): Promise<DocumentAttentionRow[]> {
  const { today } = await todayFor(companyId, now);
  return prisma.engineeringDocument.findMany({ where: { companyId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, reviewDueAt: { lt: startOf(today) }, project: { is: LIVE_PROJECT }, ...(documentId ? { id: documentId } : {}) }, take: LIMIT, select: DOCUMENT_ROW });
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

async function alreadySent(companyId: string, eventType: string, entityType: string, entityId: string, dueDate: string): Promise<boolean> {
  return (await prisma.notificationEventOutbox.count({ where: { companyId, eventType, entityType, entityId, payloadJson: { path: ["dueDate"], equals: dueDate } } })) > 0;
}

/**
 * Job `engineering.reminders` (hourly, §94, §106, §196, §199): due-soon and
 * overdue notices for RFIs and submittal reviews.
 */
export async function runEngineeringReminders(now = new Date()): Promise<{ rfiDueSoon: number; rfiOverdue: number; submittalDueSoon: number; submittalOverdue: number }> {
  const counts = { rfiDueSoon: 0, rfiOverdue: 0, submittalDueSoon: 0, submittalOverdue: 0 };
  const companyRun = await forEachCompany("engineering.reminders", async (system) => {
    const company = { id: system.companyId };
    const { settings, today } = await todayFor(company.id, now);
    const horizon = addLocalDays(today, settings.dueSoonDays);

    const [soonRfis, lateRfis, soonSubmittals, lateSubmittals] = await Promise.all([
      prisma.rfi.findMany({ where: { companyId: company.id, status: { in: ["OPEN", "CLARIFICATION_REQUIRED"] }, dueAt: { gte: startOf(today), lte: endOf(horizon) }, project: { is: LIVE_PROJECT } }, take: 2_000, select: RFI_ROW }),
      overdueRfis(company.id, now),
      prisma.technicalSubmittal.findMany({ where: { companyId: company.id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, dueAt: { gte: startOf(today), lte: endOf(horizon) }, project: { is: LIVE_PROJECT } }, take: 2_000, select: SUBMITTAL_ROW }),
      overdueSubmittalReviews(company.id, now),
    ]);

    for (const [kind, rows] of [["soon", soonRfis], ["late", lateRfis]] as const) {
      for (const row of rows) {
        const due = dateOf(row.dueAt)!;
        const eventType = kind === "soon" ? NotificationEvent.RFI_DUE_SOON : NotificationEvent.RFI_OVERDUE;
        if (await alreadySent(company.id, eventType, RFI_RECORD, row.id, due)) continue;
        await prisma.$transaction((tx) =>
          notifyEngineering(tx, {
            companyId: company.id, eventType, entityType: RFI_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: null,
            memberIds: kind === "soon" ? [row.assignedToMemberId ?? row.project.projectManagerMemberId] : [row.assignedToMemberId, row.createdByMemberId, row.priority === "CRITICAL" || row.priority === "HIGH" ? row.project.projectManagerMemberId : null],
            payload: { number: row.rfiNumber, subject: row.subject, dueDate: due, dateLabel: dateLabel(due) },
          }),
        );
        if (kind === "soon") counts.rfiDueSoon += 1;
        else counts.rfiOverdue += 1;
      }
    }

    for (const [kind, rows] of [["soon", soonSubmittals], ["late", lateSubmittals]] as const) {
      for (const row of rows) {
        const due = dateOf(row.dueAt)!;
        const eventType = kind === "soon" ? NotificationEvent.SUBMITTAL_DUE_SOON : NotificationEvent.SUBMITTAL_OVERDUE;
        if (await alreadySent(company.id, eventType, SUBMITTAL_RECORD, row.id, due)) continue;
        await prisma.$transaction((tx) =>
          notifyEngineering(tx, {
            companyId: company.id, eventType, entityType: SUBMITTAL_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: null,
            memberIds: kind === "soon" ? [row.assignedReviewerMemberId ?? row.project.projectManagerMemberId] : [row.assignedReviewerMemberId, row.project.projectManagerMemberId],
            payload: { number: row.submittalNumber, title: row.title, dueDate: due, dateLabel: dateLabel(due) },
          }),
        );
        if (kind === "soon") counts.submittalDueSoon += 1;
        else counts.submittalOverdue += 1;
      }
    }
  }, { moduleKey: MODULE });
  if (counts.rfiOverdue) incrementCounter(Metric.RFI_OVERDUE, {}, counts.rfiOverdue);
  if (counts.submittalOverdue) incrementCounter(Metric.SUBMITTAL_OVERDUE, {}, counts.submittalOverdue);
  assertEveryCompanySucceeded("engineering.reminders", companyRun);
  return counts;
}

export { DOCUMENT_RECORD };
