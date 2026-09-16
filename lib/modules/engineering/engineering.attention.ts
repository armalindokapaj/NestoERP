import type { Prisma } from "@prisma/client";

import type { AttentionRowPage } from "@/lib/core/notifications/attention.conditions";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { logger, serialiseError } from "@/lib/core/observability/logger";
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
const OPEN_RFI = { in: ["OPEN" as const, "CLARIFICATION_REQUIRED" as const] };
const IN_REVIEW = { in: ["SUBMITTED" as const, "UNDER_REVIEW" as const] };
const LIMIT = 500;

/**
 * The condition queries below take an optional page: given one, they read a
 * page of their records by id, so the attention reconciler walks the whole
 * condition (PRD #51 §133-§135); without one, the first `LIMIT` in their own order.
 */
const pageAfter = (page?: AttentionRowPage) => (page?.after ? { id: { gt: page.after } } : {});

async function todayFor(companyId: string, now: Date) {
  const settings = await resolveEngineeringSettings(companyId);
  return { settings, today: localDate(now, settings.timezone) };
}

const startOf = (date: string) => new Date(`${date}T00:00:00.000Z`);
const endOf = (date: string) => new Date(`${date}T23:59:59.999Z`);

const RFI_ROW = { id: true, projectId: true, rfiNumber: true, subject: true, priority: true, assignedToMemberId: true, createdByMemberId: true, raisedByMemberId: true, dueAt: true, status: true, openedAt: true, updatedAt: true, project: { select: { name: true, projectManagerMemberId: true } } } satisfies Prisma.RfiSelect;
export type RfiAttentionRow = Prisma.RfiGetPayload<{ select: typeof RFI_ROW }>;

/** Open RFIs on live projects due within a range. */
const rfisDue = (companyId: string, dueAt: Prisma.DateTimeNullableFilter): Prisma.RfiWhereInput => ({ companyId, status: OPEN_RFI, dueAt, project: { is: LIVE_PROJECT } });

/** RFIs waiting on an answer past their due date (§95). */
export async function overdueRfis(companyId: string, now: Date, rfiId?: string, page?: AttentionRowPage): Promise<RfiAttentionRow[]> {
  const { today } = await todayFor(companyId, now);
  return prisma.rfi.findMany({ where: { ...rfisDue(companyId, { lt: startOf(today) }), ...(rfiId ? { id: rfiId } : {}), ...pageAfter(page) }, orderBy: page ? { id: "asc" } : [{ dueAt: "asc" }, { id: "asc" }], take: page?.take ?? LIMIT, select: RFI_ROW });
}

/** RFIs waiting on their assignee, due or not (§95). */
export async function rfisAwaitingResponse(companyId: string, rfiId?: string, page?: AttentionRowPage): Promise<RfiAttentionRow[]> {
  return prisma.rfi.findMany({ where: { companyId, status: OPEN_RFI, assignedToMemberId: { not: null }, project: { is: LIVE_PROJECT }, ...(rfiId ? { id: rfiId } : {}), ...pageAfter(page) }, orderBy: page ? { id: "asc" } : [{ dueAt: "asc" }, { id: "asc" }], take: page?.take ?? LIMIT, select: RFI_ROW });
}

const SUBMITTAL_ROW = { id: true, projectId: true, submittalNumber: true, title: true, status: true, assignedReviewerMemberId: true, createdByMemberId: true, dueAt: true, updatedAt: true, currentRevision: { select: { id: true, submittedByMemberId: true, reviewedAt: true } }, project: { select: { name: true, projectManagerMemberId: true } } } satisfies Prisma.TechnicalSubmittalSelect;
export type SubmittalAttentionRow = Prisma.TechnicalSubmittalGetPayload<{ select: typeof SUBMITTAL_ROW }>;

/** Submittals in review on live projects with their review due within a range. */
const reviewsDue = (companyId: string, dueAt: Prisma.DateTimeNullableFilter): Prisma.TechnicalSubmittalWhereInput => ({ companyId, status: IN_REVIEW, dueAt, project: { is: LIVE_PROJECT } });

/** Submittals with the reviewer past their review date (§107). */
export async function overdueSubmittalReviews(companyId: string, now: Date, submittalId?: string, page?: AttentionRowPage): Promise<SubmittalAttentionRow[]> {
  const { today } = await todayFor(companyId, now);
  return prisma.technicalSubmittal.findMany({ where: { ...reviewsDue(companyId, { lt: startOf(today) }), ...(submittalId ? { id: submittalId } : {}), ...pageAfter(page) }, orderBy: page ? { id: "asc" } : [{ dueAt: "asc" }, { id: "asc" }], take: page?.take ?? LIMIT, select: SUBMITTAL_ROW });
}

/** Submittals sent back for a new revision, until one is added and submitted (§107). */
export async function submittalsNeedingRevision(companyId: string, submittalId?: string, page?: AttentionRowPage): Promise<SubmittalAttentionRow[]> {
  return prisma.technicalSubmittal.findMany({ where: { companyId, status: "REVISION_REQUIRED", project: { is: LIVE_PROJECT }, ...(submittalId ? { id: submittalId } : {}), ...pageAfter(page) }, orderBy: { id: "asc" }, take: page?.take ?? LIMIT, select: SUBMITTAL_ROW });
}

const DOCUMENT_ROW = { id: true, projectId: true, documentNumber: true, title: true, reviewerMemberId: true, reviewDueAt: true, currentRevision: { select: { id: true, revisionCode: true } }, project: { select: { name: true, projectManagerMemberId: true } } } satisfies Prisma.EngineeringDocumentSelect;
export type DocumentAttentionRow = Prisma.EngineeringDocumentGetPayload<{ select: typeof DOCUMENT_ROW }>;

/** Engineering documents under review past their review date (§197). */
export async function overdueDocumentReviews(companyId: string, now: Date, documentId?: string, page?: AttentionRowPage): Promise<DocumentAttentionRow[]> {
  const { today } = await todayFor(companyId, now);
  return prisma.engineeringDocument.findMany({ where: { companyId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, reviewDueAt: { lt: startOf(today) }, project: { is: LIVE_PROJECT }, ...(documentId ? { id: documentId } : {}), ...pageAfter(page) }, orderBy: page ? { id: "asc" } : [{ reviewDueAt: "asc" }, { id: "asc" }], take: page?.take ?? LIMIT, select: DOCUMENT_ROW });
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

const JOB = "engineering.reminders";
/** Records read at a time; a company with more is walked by cursor, never cut off (PRD #51 §133-§138). */
const BATCH = 100;

type ReminderCounts = { rfiDueSoon: number; rfiOverdue: number; submittalDueSoon: number; submittalOverdue: number };

/** One reminder a record is due: who hears, about which due date. */
type Reminder = { id: string; projectId: string; due: string; memberIds: Array<string | null>; payload: Record<string, unknown> };

/** One kind of reminder, read a page at a time in id order. */
type ReminderPass = { counter: keyof ReminderCounts; eventType: string; entityType: string; page: (after: string | undefined) => Promise<Reminder[]> };

const idAfter = (after: string | undefined) => (after ? { id: { gt: after } } : {});

function reminderPasses(companyId: string, today: string, horizon: string): ReminderPass[] {
  const soon = { gte: startOf(today), lte: endOf(horizon) };
  const late = { lt: startOf(today) };
  const rfis = (dueAt: Prisma.DateTimeNullableFilter, after: string | undefined) =>
    prisma.rfi.findMany({ where: { ...rfisDue(companyId, dueAt), ...idAfter(after) }, orderBy: { id: "asc" }, take: BATCH, select: RFI_ROW });
  const reviews = (dueAt: Prisma.DateTimeNullableFilter, after: string | undefined) =>
    prisma.technicalSubmittal.findMany({ where: { ...reviewsDue(companyId, dueAt), ...idAfter(after) }, orderBy: { id: "asc" }, take: BATCH, select: SUBMITTAL_ROW });
  const rfi = (row: RfiAttentionRow, memberIds: Array<string | null>): Reminder => {
    const due = dateOf(row.dueAt)!;
    return { id: row.id, projectId: row.projectId, due, memberIds, payload: { number: row.rfiNumber, subject: row.subject, dueDate: due, dateLabel: dateLabel(due) } };
  };
  const submittal = (row: SubmittalAttentionRow, memberIds: Array<string | null>): Reminder => {
    const due = dateOf(row.dueAt)!;
    return { id: row.id, projectId: row.projectId, due, memberIds, payload: { number: row.submittalNumber, title: row.title, dueDate: due, dateLabel: dateLabel(due) } };
  };
  return [
    {
      counter: "rfiDueSoon", eventType: NotificationEvent.RFI_DUE_SOON, entityType: RFI_RECORD,
      page: async (after) => (await rfis(soon, after)).map((row) => rfi(row, [row.assignedToMemberId ?? row.project.projectManagerMemberId])),
    },
    {
      counter: "rfiOverdue", eventType: NotificationEvent.RFI_OVERDUE, entityType: RFI_RECORD,
      page: async (after) => (await rfis(late, after)).map((row) => rfi(row, [row.assignedToMemberId, row.createdByMemberId, row.priority === "CRITICAL" || row.priority === "HIGH" ? row.project.projectManagerMemberId : null])),
    },
    {
      counter: "submittalDueSoon", eventType: NotificationEvent.SUBMITTAL_DUE_SOON, entityType: SUBMITTAL_RECORD,
      page: async (after) => (await reviews(soon, after)).map((row) => submittal(row, [row.assignedReviewerMemberId ?? row.project.projectManagerMemberId])),
    },
    {
      counter: "submittalOverdue", eventType: NotificationEvent.SUBMITTAL_OVERDUE, entityType: SUBMITTAL_RECORD,
      page: async (after) => (await reviews(late, after)).map((row) => submittal(row, [row.assignedReviewerMemberId, row.project.projectManagerMemberId])),
    },
  ];
}

/**
 * Sends one reminder unless this record was already reminded for this due
 * date, and says whether it went.
 *
 * The ledger row is claimed in the transaction that enqueues the event, so two
 * runs at once, or a run after retention has purged the first event from the
 * outbox, still send it once (PRD #51 §15-§19). A reminder with nobody to tell
 * claims nothing: whoever is assigned before the next run still hears.
 */
async function sendReminder(companyId: string, pass: ReminderPass, reminder: Reminder): Promise<boolean> {
  const memberIds = [...new Set(reminder.memberIds.filter((id): id is string => Boolean(id)))];
  if (!memberIds.length) return false;
  const claim = { companyId, jobKey: JOB, key: `${reminder.id}:${pass.eventType}:${reminder.due}` };
  if (await idempotencyKeyClaimed(prisma, claim)) return false;
  return prisma.$transaction(async (tx) => {
    if (!(await claimIdempotencyKey(tx, claim))) return false;
    await notifyEngineering(tx, { companyId, eventType: pass.eventType, entityType: pass.entityType, entityId: reminder.id, projectId: reminder.projectId, actorMemberId: null, memberIds, payload: reminder.payload });
    return true;
  });
}

/**
 * Job `engineering.reminders` (hourly, §94, §106, §196, §199): due-soon and
 * overdue notices for RFIs and submittal reviews.
 *
 * Every candidate in the company is reached, however many are overdue, and one
 * that fails is logged by id and stepped over; the company's run then fails,
 * after everything else has been sent (PRD #51 §30-§36, §133-§138).
 */
export async function runEngineeringReminders(now = new Date()): Promise<ReminderCounts> {
  const counts: ReminderCounts = { rfiDueSoon: 0, rfiOverdue: 0, submittalDueSoon: 0, submittalOverdue: 0 };
  const companyRun = await forEachCompany(JOB, async ({ companyId }) => {
    const { settings, today } = await todayFor(companyId, now);
    let failed = 0;
    for (const pass of reminderPasses(companyId, today, addLocalDays(today, settings.dueSoonDays))) {
      for (let after: string | undefined; !jobStopRequested(); ) {
        const reminders = await pass.page(after);
        for (const reminder of reminders) {
          try {
            if (await sendReminder(companyId, pass, reminder)) counts[pass.counter] += 1;
          } catch (error) {
            failed += 1;
            logger.error(`${JOB}.item_failed`, { companyId, entityType: pass.entityType, entityId: reminder.id, eventType: pass.eventType, ...serialiseError(error) });
          }
        }
        if (reminders.length < BATCH) break;
        after = reminders[reminders.length - 1]!.id;
      }
    }
    if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} engineering reminders could not be sent`);
  }, { moduleKey: MODULE });
  if (counts.rfiOverdue) incrementCounter(Metric.RFI_OVERDUE, {}, counts.rfiOverdue);
  if (counts.submittalOverdue) incrementCounter(Metric.SUBMITTAL_OVERDUE, {}, counts.submittalOverdue);
  assertEveryCompanySucceeded(JOB, companyRun);
  return counts;
}

export { DOCUMENT_RECORD };
