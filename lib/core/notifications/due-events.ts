import { resolveEnabledModules } from "@/lib/context/build-context";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { prisma } from "@/lib/database/prisma";
import { companyDays } from "./company-day";
import { NotificationEvent } from "./notification.events";
import { enqueueNotificationEvent } from "./notification.service";

/**
 * Date-driven notifications (PRD #38 §50, §74, PRD #51 §15-§19, §48, §133).
 *
 * Nothing happens at midnight that a producer could announce, so a scheduled
 * sweep does it: tasks that became overdue since the last sweep, and contract
 * obligations that came within a week of their due date. The window runs from
 * the previous successful sweep to now, so a worker that was down for a day
 * catches up instead of skipping it.
 *
 * The window overlaps from one hourly sweep to the next on purpose. What makes
 * that harmless is the idempotency ledger, claimed in the transaction that
 * enqueues the event: one event per record per due date, however many sweeps
 * or workers see it — and unlike counting outbox rows, still true after the
 * outbox has been purged.
 *
 * "Today" is the company's: a task due yesterday in Tirane is overdue from
 * Tirane's midnight, not the server's.
 */

const JOB = "notifications.due";
const DAY_MS = 86_400_000;
const OBLIGATION_NOTICE_DAYS = 7;
/** Rows read at a time; each is enqueued in its own short transaction (PRD #51 §132-§135). */
const BATCH = 100;

export type DueEventsResult = { tasksOverdue: number; obligationsDue: number };

export async function enqueueDueNotifications(options: { now?: Date; since?: Date | null } = {}): Promise<DueEventsResult> {
  const now = options.now ?? new Date();
  const result: DueEventsResult = { tasksOverdue: 0, obligationsDue: 0 };
  let failed = 0;

  const run = await forEachCompany(JOB, async ({ companyId }) => {
    const dayOf = await companyDays(companyId);
    const today = dayOf(now).start;
    // First run: only what became due in the last day, not the whole backlog.
    const from = dayOf(options.since ?? new Date(now.getTime() - DAY_MS)).start;
    // Tasks and Legal are switchable; a company without one is told nothing about it.
    const modules = new Set(await resolveEnabledModules(companyId));

    if (modules.has("tasks")) {
      const tasks = await eachRow(
        companyId,
        "task",
        (afterId) =>
          prisma.task.findMany({
            where: {
              companyId,
              archivedAt: null,
              status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
              assigneeMemberId: { not: null },
              // A task falls overdue the day after it was due, so one due the day
              // before `from` crossed into overdue within the window.
              dueDate: { gte: new Date(from.getTime() - DAY_MS), lt: today },
              ...(afterId ? { id: { gt: afterId } } : {}),
            },
            select: { id: true, title: true, projectId: true, dueDate: true, assigneeMemberId: true },
            orderBy: { id: "asc" },
            take: BATCH,
          }),
        (task) => {
          const dueDate = isoDate(task.dueDate!);
          return enqueueOnce(companyId, `task:${task.id}:${dueDate}`, {
            companyId,
            eventType: NotificationEvent.TASK_OVERDUE,
            moduleKey: "tasks",
            entityType: "task",
            entityId: task.id,
            projectId: task.projectId,
            payload: { title: task.title, dueDate, assigneeMemberId: task.assigneeMemberId },
          });
        },
      );
      result.tasksOverdue += tasks.enqueued;
      failed += tasks.failed;
    }

    if (modules.has("contracts")) {
      const obligations = await eachRow(
        companyId,
        "obligation",
        (afterId) =>
          prisma.contractObligation.findMany({
            where: {
              companyId,
              status: "OPEN",
              dueDate: { gte: new Date(from.getTime() + OBLIGATION_NOTICE_DAYS * DAY_MS), lt: new Date(today.getTime() + (OBLIGATION_NOTICE_DAYS + 1) * DAY_MS) },
              contract: { archivedAt: null },
              ...(afterId ? { id: { gt: afterId } } : {}),
            },
            select: {
              id: true,
              title: true,
              dueDate: true,
              responsibleMemberId: true,
              contract: { select: { contractNumber: true, title: true, ownerMemberId: true, projectId: true } },
            },
            orderBy: { id: "asc" },
            take: BATCH,
          }),
        (obligation) => {
          const dueDate = isoDate(obligation.dueDate!);
          return enqueueOnce(companyId, `obligation:${obligation.id}:${dueDate}`, {
            companyId,
            eventType: NotificationEvent.CONTRACT_OBLIGATION_DUE,
            moduleKey: "contracts",
            entityType: "obligation",
            entityId: obligation.id,
            projectId: obligation.contract.projectId,
            payload: {
              title: obligation.title,
              dueDate,
              responsibleMemberId: obligation.responsibleMemberId,
              contractOwnerMemberId: obligation.contract.ownerMemberId,
              contractLabel: `${obligation.contract.contractNumber} · ${obligation.contract.title}`,
            },
          });
        },
      );
      result.obligationsDue += obligations.enqueued;
      failed += obligations.failed;
    }
  });

  assertEveryCompanySucceeded(JOB, run);
  if (failed > 0) throw new JobError("PARTIAL_FAILURE", `${JOB} could not enqueue ${failed} reminders; every other reminder was enqueued`);
  return result;
}

/** The event, unless this record's reminder for this due date was already enqueued. */
function enqueueOnce(companyId: string, key: string, event: Parameters<typeof enqueueNotificationEvent>[1]): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    if (!(await claimIdempotencyKey(tx, { companyId, jobKey: JOB, key }))) return false;
    await enqueueNotificationEvent(tx, event);
    return true;
  });
}

/**
 * Walks a query by id in small batches and enqueues each row on its own
 * (PRD #51 §30-§36, §133-§135): a row that fails is logged by id and passed
 * over, and the rows after it still go out.
 */
async function eachRow<Row extends { id: string }>(
  companyId: string,
  entityType: string,
  read: (afterId: string | undefined) => Promise<Row[]>,
  enqueue: (row: Row) => Promise<boolean>,
): Promise<{ enqueued: number; failed: number }> {
  const outcome = { enqueued: 0, failed: 0 };
  let afterId: string | undefined;
  while (!jobStopRequested()) {
    const rows = await read(afterId);
    for (const row of rows) {
      try {
        if (await enqueue(row)) outcome.enqueued += 1;
      } catch (error) {
        outcome.failed += 1;
        logger.error(`${JOB}.item_failed`, { companyId, entityType, entityId: row.id, ...serialiseError(error) });
      }
    }
    if (rows.length < BATCH) break;
    afterId = rows[rows.length - 1].id;
  }
  return outcome;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
