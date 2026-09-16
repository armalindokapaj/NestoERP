import type { ModuleKey } from "@/config/modules";
import { resolveEnabledModules } from "@/lib/context/build-context";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { companyDays } from "@/lib/core/notifications/company-day";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { prisma } from "@/lib/database/prisma";

/**
 * Overdue approval reminders (PRD #41 §40, §163, §164, §228, PRD #51 §15-§19, §48).
 *
 * Once a day, the people who could decide an approval past a real deadline
 * are reminded. Only sources with such a date take part — a review's due
 * date, leave's first day, a proposal's validity, a permit's start. No generic
 * escalation engine: whoever could decide it hears about it, as the owning
 * module already defines.
 *
 * "Once a day" is one idempotency-ledger row per approval step per company-
 * local day, claimed in the transaction that enqueues the reminder: an hourly
 * scheduler, a second worker or a rerun adds nothing. The step is the unit —
 * a document version with three reviewers is three reviews, and each reviewer
 * is reminded of their own.
 */

const JOB = "approvals.overdue";
/** Rows read at a time; each reminder is enqueued in its own short transaction (PRD #51 §132-§135). */
const BATCH = 100;

type OverdueApproval = {
  /** The source row, for the cursor. */
  id: string;
  /** The approval step: what the ledger and the notification's dedupe key are about. */
  approvalKey: string;
  entityType: string;
  entityId: string;
  projectId: string | null;
  payload: Record<string, unknown>;
};

type OverdueSource = {
  /** The module the record lives in; a company that switched it off is not reminded. */
  moduleKey: ModuleKey;
  read(companyId: string, today: Date, afterId: string | undefined): Promise<OverdueApproval[]>;
};

/** Starts a query after the last row read. An id never changes, so a row that stays overdue is never skipped. */
const after = (afterId: string | undefined) => (afterId ? { id: { gt: afterId } } : {});
const byId = { orderBy: { id: "asc" as const }, take: BATCH };

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const SOURCES: OverdueSource[] = [
  {
    moduleKey: "documents",
    read: async (companyId, today, afterId) =>
      (
        await prisma.documentReview.findMany({
          where: { companyId, status: "PENDING", dueAt: { lt: today }, ...after(afterId) },
          select: { id: true, documentId: true, reviewerMemberId: true, dueAt: true },
          ...byId,
        })
      ).map((row) => ({
        id: row.id,
        approvalKey: `documents:${row.id}`,
        entityType: "document",
        entityId: row.documentId,
        projectId: null,
        payload: { dueDate: isoDate(row.dueAt!), approverMemberIds: [row.reviewerMemberId], recordLabel: "A document review" },
      })),
  },
  {
    moduleKey: "hr",
    read: async (companyId, today, afterId) =>
      (
        await prisma.leaveRequest.findMany({
          where: { companyId, status: "PENDING", startDate: { lt: today }, ...after(afterId) },
          select: { id: true, startDate: true, companyMemberId: true },
          ...byId,
        })
      ).map((row) => ({
        id: row.id,
        approvalKey: `hr:${row.id}`,
        entityType: "leave_request",
        entityId: row.id,
        projectId: null,
        payload: { dueDate: isoDate(row.startDate), approvePermissions: ["hr.leave.approve"], excludeMemberIds: [row.companyMemberId], recordLabel: "A leave request" },
      })),
  },
  {
    moduleKey: "sales",
    read: async (companyId, today, afterId) =>
      (
        await prisma.proposal.findMany({
          where: { companyId, status: "PENDING_APPROVAL", validUntil: { lt: today }, ...after(afterId) },
          select: { id: true, validUntil: true },
          ...byId,
        })
      ).map((row) => ({
        id: row.id,
        approvalKey: `sales:${row.id}`,
        entityType: "proposal",
        entityId: row.id,
        projectId: null,
        payload: { dueDate: isoDate(row.validUntil!), approvePermissions: ["sales.proposal.approve"], recordLabel: "A proposal" },
      })),
  },
  {
    moduleKey: "hse",
    read: async (companyId, today, afterId) =>
      (
        await prisma.hseWorkPermit.findMany({
          where: { companyId, status: "PENDING_APPROVAL", validFrom: { lt: today }, ...after(afterId) },
          select: { id: true, projectId: true, validFrom: true },
          ...byId,
        })
      ).map((row) => ({
        id: row.id,
        approvalKey: `hse:${row.id}`,
        entityType: "work_permit",
        entityId: row.id,
        projectId: row.projectId,
        payload: { dueDate: isoDate(row.validFrom), approvePermissions: ["hse.permit.approve"], recordLabel: "A work permit" },
      })),
  },
];

export async function remindOverdueApprovals(now = new Date()): Promise<{ enqueued: number }> {
  let enqueued = 0;
  let failed = 0;

  const run = await forEachCompany(JOB, async ({ companyId }) => {
    const { day, start: today } = (await companyDays(companyId))(now);
    const modules = new Set(await resolveEnabledModules(companyId));
    for (const source of SOURCES) {
      if (!modules.has(source.moduleKey)) continue;
      let afterId: string | undefined;
      while (!jobStopRequested()) {
        const approvals = await source.read(companyId, today, afterId);
        for (const approval of approvals) {
          try {
            if (await remindOnce(companyId, source.moduleKey, approval, day)) enqueued += 1;
          } catch (error) {
            // One bad row is logged by id and passed over; the reminders after it still go out.
            failed += 1;
            logger.error(`${JOB}.item_failed`, { companyId, approvalKey: approval.approvalKey, entityType: approval.entityType, entityId: approval.entityId, ...serialiseError(error) });
          }
        }
        if (approvals.length < BATCH) break;
        afterId = approvals[approvals.length - 1].id;
      }
    }
  });

  if (enqueued > 0) incrementCounter(Metric.APPROVAL_OVERDUE, {}, enqueued);
  assertEveryCompanySucceeded(JOB, run);
  if (failed > 0) throw new JobError("PARTIAL_FAILURE", `${JOB} could not remind ${failed} overdue approvals; every other reminder was enqueued`);
  return { enqueued };
}

function remindOnce(companyId: string, moduleKey: ModuleKey, approval: OverdueApproval, day: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    if (!(await claimIdempotencyKey(tx, { companyId, jobKey: JOB, key: `${approval.approvalKey}:${day}` }))) return false;
    await enqueueNotificationEvent(tx, {
      companyId,
      eventType: NotificationEvent.APPROVAL_OVERDUE,
      moduleKey,
      entityType: approval.entityType,
      entityId: approval.entityId,
      actorMemberId: null,
      projectId: approval.projectId,
      // `day` keeps the notification's own dedupe key to one a day as well (notification.events.ts).
      payload: { approvalKey: approval.approvalKey, ...approval.payload, day },
    });
    return true;
  });
}
