import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { assertApprovalGuard, type ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { closeOpenSteps, createApprovalSteps, currentStepOf, loadApprovalSteps, settleStep, stepEligibility } from "@/lib/core/approvals/approval-steps";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { resolveApprovalAttention } from "@/lib/core/notifications/approval-notifications";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { resolveApprover } from "./timesheet.approvers";
import { EDITABLE_STATUSES, isEditableStatus, MODULE, readableTimesheetWhere, timesheetsOpen } from "./timesheet.permissions";
import { resolveTimesheetSettings } from "./timesheet.settings";
import { getTimesheet } from "./timesheet.service";
import { dateOf, formatMinutes, weekLabel } from "./timesheet.time";
import type { TimesheetWeekDTO } from "./timesheet.types";

/**
 * Submitting and deciding a week (PRD #42 §8, §62-§69, §80-§86, §117-§119,
 * §164-§167, §212).
 *
 * Submission validates every entry again, resolves the approver on the server
 * and opens an approval cycle the Approvals Center shows (provider
 * `timesheets`) — one step, belonging to the designated approver. The week is
 * then read-only. A decision is taken by that approver, or by someone they have
 * delegated to, never by the member; it settles the step and the cycle, locks
 * or returns the week, and tells the member — all in one transaction with its
 * audit.
 */

export const PROVIDER_KEY = "timesheets";
const ACTIVITY_ENTITY = "Timesheet";

function fail(code: string, message: string, status: "VALIDATION_ERROR" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" = "CONFLICT", extra: Record<string, unknown> = {}): AccessError {
  return new AccessError(status, message, { code, ...extra });
}

async function memberName(memberId: string): Promise<string> {
  const row = await prisma.companyMember.findUnique({ where: { id: memberId }, select: { user: { select: { firstName: true, lastName: true } } } });
  return row ? `${row.user.firstName} ${row.user.lastName}` : "A colleague";
}

/** Whether a member, in their own context, could open this week. */
export function timesheetReadableBy(timesheetId: string) {
  return async (memberContext: UserContext): Promise<boolean> => {
    if (!timesheetsOpen(memberContext)) return false;
    return (await prisma.timesheet.count({ where: { AND: [await readableTimesheetWhere(memberContext), { id: timesheetId }] } })) > 0;
  };
}

export async function submitTimesheet(
  context: UserContext,
  timesheetId: string,
  input: { expectedVersion: number; acknowledgeShortfall?: boolean },
): Promise<TimesheetWeekDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "timesheet.submit_own");

  const week = await prisma.timesheet.findFirst({
    where: { id: timesheetId, companyId: context.companyId, memberId: context.membershipId },
    select: { id: true, status: true, version: true, periodStart: true, submissionVersion: true },
  });
  if (!week) throw fail("TIMESHEET_NOT_FOUND", "That timesheet could not be found.", "NOT_FOUND");
  if (week.status === "SUBMITTED") throw fail("TIMESHEET_ALREADY_SUBMITTED", "This week has already been submitted.");
  if (week.status === "APPROVED") throw fail("TIMESHEET_ALREADY_APPROVED", "This week is already approved.");
  if (!isEditableStatus(week.status)) throw fail("TIMESHEET_LOCKED", "This week cannot be submitted.");
  if (week.version !== input.expectedVersion) throw fail("STALE_VERSION", "Your week changed in another window. Review it again before submitting.");

  // Every entry, checked again as it is now (§67).
  const settings = await resolveTimesheetSettings(context.companyId);
  const today = localDate(new Date(), settings.timezone);
  const logs = await prisma.workLog.findMany({
    where: { timesheetId: week.id },
    select: { id: true, workDate: true, minutes: true, workType: true, description: true, projectId: true, taskId: true, project: { select: { archivedAt: true } }, task: { select: { projectId: true, archivedAt: true } } },
  });
  if (logs.length === 0) throw fail("TIMESHEET_EMPTY", "Log some time before submitting the week.", "VALIDATION_ERROR");
  const byDay = new Map<string, number>();
  for (const log of logs) {
    const day = dateOf(log.workDate);
    byDay.set(day, (byDay.get(day) ?? 0) + log.minutes);
    if (day > today) throw fail("TIMESHEET_INVALID_DATE", `An entry on ${day} is in the future.`, "VALIDATION_ERROR");
    if (log.workType === "PROJECT_WORK" && !log.projectId) throw fail("TIMESHEET_PROJECT_REQUIRED", `An entry on ${day} is project work without a project.`, "VALIDATION_ERROR");
    if (log.task && (log.task.projectId ?? null) !== (log.projectId ?? null)) throw fail("TIMESHEET_TASK_PROJECT_MISMATCH", `An entry on ${day} names a task from another project.`, "VALIDATION_ERROR");
    if (settings.enforceIncrement && log.minutes % settings.incrementMinutes !== 0) throw fail("TIMESHEET_INCREMENT", `An entry on ${day} is not in steps of ${settings.incrementMinutes} minutes.`, "VALIDATION_ERROR");
  }
  for (const [day, minutes] of byDay) {
    if (minutes > 24 * 60) throw fail("TIMESHEET_DAILY_LIMIT", `${day} holds more than 24 hours.`, "VALIDATION_ERROR");
  }
  if (settings.descriptionsRequired) {
    const missing = logs.filter((log) => !log.description?.trim()).length;
    if (missing > 0) throw fail("TIMESHEET_DESCRIPTION_REQUIRED", `${missing} ${missing === 1 ? "entry needs" : "entries need"} a description before the week is submitted.`, "VALIDATION_ERROR", { missing });
  }

  const detail = await getTimesheet(context, week.id);
  if (!input.acknowledgeShortfall && detail.totals.totalMinutes < detail.totals.expectedMinutes) {
    throw fail("TIMESHEET_BELOW_EXPECTED", `You logged ${formatMinutes(detail.totals.totalMinutes)} of the expected ${formatMinutes(detail.totals.expectedMinutes)}.`, "CONFLICT", {
      loggedMinutes: detail.totals.totalMinutes,
      expectedMinutes: detail.totals.expectedMinutes,
    });
  }

  const approver = await resolveApprover(context.companyId, context.membershipId);
  if (!approver) throw fail("TIMESHEET_NO_APPROVER", "Nobody is set to approve your timesheets yet. Ask HR to assign an approver.", "VALIDATION_ERROR");

  const label = weekLabel(dateOf(week.periodStart));
  await prisma.$transaction(async (tx) => {
    const moved = await tx.timesheet.updateMany({
      where: { id: week.id, version: input.expectedVersion, status: { in: [...EDITABLE_STATUSES] } },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        submittedByMemberId: context.membershipId,
        approverMemberId: approver.memberId,
        submissionVersion: { increment: 1 },
        version: { increment: 1 },
        decisionNote: null,
      },
    });
    if (moved.count === 0) throw fail("STALE_VERSION", "Your week changed in another window. Review it again before submitting.");

    await tx.timesheetApproval.updateMany({ where: { recordId: week.id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
    const cycle = await tx.timesheetApproval.create({
      data: { companyId: context.companyId, recordId: week.id, submissionVersion: week.submissionVersion + 1, approverMemberId: approver.memberId, submittedByMemberId: context.membershipId },
      select: { id: true },
    });
    await createApprovalSteps(tx, {
      companyId: context.companyId,
      providerKey: PROVIDER_KEY,
      approvalId: cycle.id,
      steps: [{ label: "Approver", approverMemberId: approver.memberId, approverPermission: "timesheet.approve" }],
    });

    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.TIMESHEET_SUBMITTED,
      moduleKey: MODULE,
      entityType: "timesheet",
      entityId: week.id,
      actorMemberId: context.membershipId,
      payload: { approverMemberId: approver.memberId, memberName: context.fullName, weekLabel: label, totalLabel: formatMinutes(detail.totals.totalMinutes), submissionVersion: week.submissionVersion + 1 },
    });
    // The member's own "not submitted" and "returned" reminders end here (§214).
    await resolveAttentionForRecord(tx, context.companyId, "timesheet", week.id, ["TIMESHEET_NOT_SUBMITTED", "TIMESHEET_RETURNED"]);
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: week.id, action: "TIMESHEET_SUBMITTED", message: `submitted the timesheet for ${label}` });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.TIMESHEET_SUBMITTED,
        entity: { type: "timesheet", id: week.id, label: `Timesheet ${label}` },
        after: { approvalId: cycle.id, submissionVersion: week.submissionVersion + 1, approverMemberId: approver.memberId, totalMinutes: detail.totals.totalMinutes },
      },
      { tx },
    );
  });
  incrementCounter(Metric.TIMESHEET_SUBMIT_SUCCESS);
  return getTimesheet(context, week.id);
}

type Outcome = "APPROVED" | "RETURNED" | "REJECTED";

const PERMISSION = { APPROVED: "timesheet.approve", RETURNED: "timesheet.return", REJECTED: "timesheet.reject" } as const;

async function decide(context: UserContext, timesheetId: string, outcome: Outcome, note: string | null, guard?: ApprovalGuard): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, PERMISSION[outcome]);
  if (outcome !== "APPROVED" && !note?.trim()) throw fail("TIMESHEET_REASON_REQUIRED", "Give a reason.", "VALIDATION_ERROR");

  const week = await prisma.timesheet.findFirst({
    where: { id: timesheetId, companyId: context.companyId },
    select: { id: true, memberId: true, status: true, version: true, periodStart: true, submissionVersion: true },
  });
  if (!week) throw fail("TIMESHEET_NOT_FOUND", "That timesheet could not be found.", "NOT_FOUND");
  if (week.memberId === context.membershipId) {
    throw fail("TIMESHEET_SELF_APPROVAL_BLOCKED", "This is your own timesheet, so somebody else decides it.", "FORBIDDEN");
  }
  if (week.status !== "SUBMITTED") throw fail("TIMESHEET_ALREADY_DECIDED", "This week is not waiting for a decision.");

  const label = weekLabel(dateOf(week.periodStart));
  await prisma.$transaction(async (tx) => {
    const cycle = await tx.timesheetApproval.findFirst({ where: { recordId: week.id, status: "PENDING" }, orderBy: { submittedAt: "desc" }, select: { id: true, submittedByMemberId: true } });
    if (!cycle) throw fail("TIMESHEET_ALREADY_DECIDED", "This week is not waiting for a decision.");
    const steps = await loadApprovalSteps(PROVIDER_KEY, cycle.id, tx);
    const step = currentStepOf(steps);
    if (!step) throw fail("TIMESHEET_ALREADY_DECIDED", "This week is not waiting for a decision.");
    assertApprovalGuard(guard, cycle, guard?.stepNumber === undefined ? undefined : step.stepNumber);

    const verdict = await stepEligibility(context, step, {
      providerKey: PROVIDER_KEY,
      steps,
      submittedByMemberId: week.memberId,
      canReadAs: timesheetReadableBy(week.id),
    });
    if (!verdict.eligible) {
      throw fail("APPROVAL_NOT_CURRENT_APPROVER", "This week is waiting for its designated approver.", "FORBIDDEN");
    }

    await settleStep(tx, context, step, outcome, note, verdict.onBehalfOfMemberId);
    await closeOpenSteps(tx, PROVIDER_KEY, cycle.id);
    const settled = await tx.timesheetApproval.updateMany({ where: { id: cycle.id, status: "PENDING" }, data: { status: outcome, decidedByMemberId: context.membershipId, decidedAt: new Date(), decisionNote: note } });
    if (settled.count === 0) throw fail("TIMESHEET_ALREADY_DECIDED", "This week was already decided.");

    const now = new Date();
    const stamp: Prisma.TimesheetUpdateManyMutationInput =
      outcome === "APPROVED"
        ? { approvedAt: now, approvedByMemberId: context.membershipId }
        : outcome === "RETURNED"
          ? { returnedAt: now, returnedByMemberId: context.membershipId }
          : { rejectedAt: now, rejectedByMemberId: context.membershipId };
    const moved = await tx.timesheet.updateMany({
      where: { id: week.id, status: "SUBMITTED", version: week.version },
      data: { ...stamp, status: outcome, decisionNote: note, version: { increment: 1 } },
    });
    if (moved.count === 0) throw fail("STALE_VERSION", "This week changed since you opened it. Review it again.");

    await resolveApprovalAttention(tx, context.companyId, { recordType: "timesheet", recordId: week.id });
    await resolveAttentionForRecord(tx, context.companyId, "timesheet", week.id, ["TIMESHEET_APPROVAL_OVERDUE"]);

    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: outcome === "APPROVED" ? NotificationEvent.TIMESHEET_APPROVED : outcome === "RETURNED" ? NotificationEvent.TIMESHEET_RETURNED : NotificationEvent.TIMESHEET_REJECTED,
      moduleKey: MODULE,
      entityType: "timesheet",
      entityId: week.id,
      actorMemberId: context.membershipId,
      payload: { memberId: week.memberId, weekLabel: label, actorName: context.fullName, reason: outcome === "APPROVED" ? null : note },
    });
    const verb = outcome === "APPROVED" ? "approved" : outcome === "RETURNED" ? "returned" : "rejected";
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: week.id, action: `TIMESHEET_${outcome}`, message: `${verb} the timesheet for ${label}` });
    await recordUserAction(
      context,
      {
        actionKey: outcome === "APPROVED" ? AuditAction.TIMESHEET_APPROVED : outcome === "RETURNED" ? AuditAction.TIMESHEET_RETURNED : AuditAction.TIMESHEET_REJECTED,
        entity: { type: "timesheet", id: week.id, label: `Timesheet ${label}` },
        after: { approvalId: cycle.id, status: outcome, submissionVersion: week.submissionVersion, hasNote: Boolean(note?.trim()), ...(verdict.onBehalfOfMemberId ? { onBehalfOfMemberId: verdict.onBehalfOfMemberId } : {}) },
        reason: outcome === "APPROVED" ? null : note,
      },
      { tx },
    );
  });
  incrementCounter(outcome === "RETURNED" ? Metric.TIMESHEET_RETURN : Metric.TIMESHEET_APPROVAL_SUCCESS, { outcome });
}

export async function approveTimesheet(context: UserContext, timesheetId: string, note: string | null, guard?: ApprovalGuard): Promise<void> {
  await decide(context, timesheetId, "APPROVED", note, guard);
}

export async function returnTimesheet(context: UserContext, timesheetId: string, note: string, guard?: ApprovalGuard): Promise<void> {
  await decide(context, timesheetId, "RETURNED", note, guard);
}

export async function rejectTimesheet(context: UserContext, timesheetId: string, note: string, guard?: ApprovalGuard): Promise<void> {
  await decide(context, timesheetId, "REJECTED", note, guard);
}

/**
 * The controlled correction of an approved week (§117-§119): an authorised
 * person reopens it with a note, it goes back to the member as returned, and
 * both the reopening and the new submission stay on the record.
 */
export async function reopenTimesheet(context: UserContext, timesheetId: string, input: { note: string }): Promise<TimesheetWeekDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "timesheet.reopen");
  const week = await prisma.timesheet.findFirst({ where: { AND: [await readableTimesheetWhere(context), { id: timesheetId }] }, select: { id: true, memberId: true, status: true, version: true, periodStart: true } });
  if (!week) throw fail("TIMESHEET_NOT_FOUND", "That timesheet could not be found.", "NOT_FOUND");
  if (week.memberId === context.membershipId) throw fail("TIMESHEET_SELF_REOPEN_BLOCKED", "Somebody else reopens your approved week.", "FORBIDDEN");
  if (week.status !== "APPROVED") throw fail("TIMESHEET_NOT_APPROVED", "Only an approved week is reopened.");

  const label = weekLabel(dateOf(week.periodStart));
  await prisma.$transaction(async (tx) => {
    const moved = await tx.timesheet.updateMany({
      where: { id: week.id, status: "APPROVED", version: week.version },
      data: { status: "RETURNED", returnedAt: new Date(), returnedByMemberId: context.membershipId, reopenedAt: new Date(), reopenedByMemberId: context.membershipId, decisionNote: input.note, version: { increment: 1 } },
    });
    if (moved.count === 0) throw fail("STALE_VERSION", "This week changed since you opened it.");
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: week.id, action: "TIMESHEET_REOPENED", message: `reopened the approved timesheet for ${label}`, metadata: { note: input.note } as Prisma.InputJsonValue });
    await recordUserAction(context, { actionKey: AuditAction.TIMESHEET_REOPENED, entity: { type: "timesheet", id: week.id, label: `Timesheet ${label}` }, before: { status: "APPROVED" }, after: { status: "RETURNED" }, reason: input.note }, { tx });
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.TIMESHEET_RETURNED,
      moduleKey: MODULE,
      entityType: "timesheet",
      entityId: week.id,
      actorMemberId: context.membershipId,
      payload: { memberId: week.memberId, weekLabel: label, reason: input.note, reopened: true, memberName: await memberName(week.memberId) },
    });
  });
  return getTimesheet(context, week.id);
}

export function canDecideTimesheets(context: UserContext): boolean {
  return can(context, "timesheet.approve") || can(context, "timesheet.return") || can(context, "timesheet.reject");
}
