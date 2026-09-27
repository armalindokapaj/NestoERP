import { Prisma, type WorkLogType } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { EDITABLE_STATUSES, isEditableStatus, MODULE } from "./timesheet.permissions";
import type { CellInput, WorkLogInput, WorkLogUpdateInput } from "./timesheet.schema";
import { resolveTimesheetSettings } from "./timesheet.settings";
import { addLocalDays, businessInstant, daysBetween, MINUTES_PER_DAY, weekDays, weekStartOf } from "./timesheet.time";
import type { TimesheetSettingsDTO } from "./timesheet.types";

/**
 * Work logs (PRD #42 §14-§31, §41, §42, §46-§51, §58-§65, §115, §155-§161).
 *
 * Always the signed-in member's own time, on their own week, while the week
 * is still theirs to change — draft, returned or rejected. Every rule the PRD
 * sets is checked here, on every write, whatever the screen allowed:
 *
 *   - no future days, nothing older than the company's backdating window
 *   - whole minutes, at least 5, never more than 24 hours in one day
 *   - project work names a project the member can open and that is still live
 *   - a task belongs to that project, and the member can open it too
 *   - the company's step, where the company enforces one
 *
 * A week is created the first time somebody logs time in it (§41), and there
 * is only ever one per member and week (§42).
 */

type Tx = Prisma.TransactionClient;

function fail(code: string, message: string, status: "VALIDATION_ERROR" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" = "VALIDATION_ERROR"): AccessError {
  return new AccessError(status, message, { code });
}

function assertOwnTime(context: UserContext): void {
  assertModule(context, MODULE);
  assertPermission(context, "timesheet.edit_own");
}

async function environment(context: UserContext): Promise<{ settings: TimesheetSettingsDTO; today: string }> {
  const settings = await resolveTimesheetSettings(context.companyId);
  return { settings, today: localDate(new Date(), settings.timezone) };
}

export function defaultBillable(workType: WorkLogType): boolean {
  return workType === "PROJECT_WORK";
}

function billableFor(context: UserContext, settings: TimesheetSettingsDTO, input: { workType: WorkLogType; billable?: boolean }, current?: boolean): boolean {
  const mayChoose = settings.membersSetBillable || can(context, "timesheet.approve");
  if (input.billable !== undefined && mayChoose) return input.billable;
  return current ?? defaultBillable(input.workType);
}

/** The rules every entry obeys, checked against the database as it is now. */
async function assertEntry(
  context: UserContext,
  env: { settings: TimesheetSettingsDTO; today: string },
  input: Pick<WorkLogInput, "workDate" | "workType" | "projectId" | "taskId" | "minutes">,
  options: { excludeLogIds?: string[] } = {},
): Promise<{ projectId: string | null; taskId: string | null }> {
  const { settings, today } = env;
  if (input.workDate > today) throw fail("TIMESHEET_INVALID_DATE", "Time cannot be logged for a day that has not happened yet.");
  if (daysBetween(input.workDate, today) > settings.backdateDays) {
    // A week sent back for correction stays correctable, however old it is (§64, §65, §117).
    const sentBack = await prisma.timesheet.count({
      where: { companyId: context.companyId, memberId: context.membershipId, periodStart: businessInstant(weekStartOf(input.workDate, settings.weekStartsOn)), status: { in: ["RETURNED", "REJECTED"] } },
    });
    if (sentBack === 0) throw fail("TIMESHEET_BACKDATE_LIMIT", `Time can be logged up to ${settings.backdateDays} days back.`);
  }
  if (input.minutes < 5 || input.minutes > MINUTES_PER_DAY) throw fail("TIMESHEET_INVALID_DURATION", "An entry is between 5 minutes and 24 hours.");
  if (settings.enforceIncrement && input.minutes % settings.incrementMinutes !== 0) {
    throw fail("TIMESHEET_INCREMENT", `Log time in steps of ${settings.incrementMinutes} minutes.`);
  }
  if (input.workType === "PROJECT_WORK" && !input.projectId) throw fail("TIMESHEET_PROJECT_REQUIRED", "Project work needs a project.");

  let projectId: string | null = null;
  if (input.projectId) {
    const project =
      canAccessModule(context, "projects") && can(context, "project.view")
        ? await prisma.project.findFirst({ where: { AND: [buildProjectScopeWhere(context), { id: input.projectId }] }, select: { id: true, archivedAt: true, status: true } })
        : null;
    if (!project) throw fail("TIMESHEET_PROJECT_NOT_ALLOWED", "You cannot log time to that project.");
    if (project.archivedAt) throw fail("TIMESHEET_PROJECT_ARCHIVED", "That project is archived; time can no longer be logged to it.");
    projectId = project.id;
  }

  let taskId: string | null = null;
  if (input.taskId) {
    const task =
      canAccessModule(context, "tasks") && can(context, "task.view")
        ? await prisma.task.findFirst({ where: { AND: [buildTaskScopeWhere(context), { id: input.taskId }] }, select: { id: true, projectId: true, archivedAt: true } })
        : null;
    if (!task) throw fail("TIMESHEET_TASK_NOT_ALLOWED", "You cannot log time to that task.");
    if (task.archivedAt) throw fail("TIMESHEET_TASK_ARCHIVED", "That task is archived; time can no longer be logged to it.");
    if ((task.projectId ?? null) !== projectId) throw fail("TIMESHEET_TASK_PROJECT_MISMATCH", "That task belongs to a different project.");
    taskId = task.id;
  }

  const day = await prisma.workLog.aggregate({
    where: { companyId: context.companyId, memberId: context.membershipId, workDate: businessInstant(input.workDate), ...(options.excludeLogIds?.length ? { id: { notIn: options.excludeLogIds } } : {}) },
    _sum: { minutes: true },
  });
  if ((day._sum.minutes ?? 0) + input.minutes > MINUTES_PER_DAY) {
    throw fail("TIMESHEET_DAILY_LIMIT", "A day cannot hold more than 24 hours.");
  }
  return { projectId, taskId };
}

/** The member's week for a day, created as a draft the first time it is needed (§41, §42). */
async function ensureWeek(tx: Tx, context: UserContext, settings: TimesheetSettingsDTO, workDate: string) {
  const periodStart = weekStartOf(workDate, settings.weekStartsOn);
  const existing = await tx.timesheet.findUnique({
    where: { companyId_memberId_periodStart: { companyId: context.companyId, memberId: context.membershipId, periodStart: businessInstant(periodStart) } },
    select: { id: true, status: true, version: true },
  });
  if (existing) return existing;
  try {
    const created = await tx.timesheet.create({
      data: {
        companyId: context.companyId,
        memberId: context.membershipId,
        periodStart: businessInstant(periodStart),
        periodEnd: businessInstant(addLocalDays(periodStart, 6)),
      },
      select: { id: true, status: true, version: true },
    });
    await recordUserAction(context, { actionKey: AuditAction.TIMESHEET_CREATED, entity: { type: "timesheet", id: created.id }, after: { memberId: context.membershipId, periodStart } }, { tx });
    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw fail("TIMESHEET_CONCURRENT_CREATE", "Your week was just created in another window. Try again.", "CONFLICT");
    }
    throw error;
  }
}

/** Marks the week changed, refusing if it has been submitted in the meantime. */
async function touchWeek(tx: Tx, timesheetId: string): Promise<void> {
  const result = await tx.timesheet.updateMany({ where: { id: timesheetId, status: { in: [...EDITABLE_STATUSES] } }, data: { version: { increment: 1 } } });
  if (result.count === 0) throw fail("TIMESHEET_LOCKED", "This week has been submitted, so its time cannot change.", "CONFLICT");
}

function lockedError(status: string): AccessError {
  return status === "APPROVED"
    ? fail("TIMESHEET_ALREADY_APPROVED", "This week is approved and locked.", "CONFLICT")
    : fail("TIMESHEET_LOCKED", "This week has been submitted, so its time cannot change.", "CONFLICT");
}

export async function createWorkLog(context: UserContext, input: WorkLogInput): Promise<{ timesheetId: string; workLogId: string }> {
  assertOwnTime(context);
  const env = await environment(context);
  const refs = await assertEntry(context, env, input);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const week = await ensureWeek(tx, context, env.settings, input.workDate);
      if (!isEditableStatus(week.status)) throw lockedError(week.status);
      const log = await tx.workLog.create({
        data: {
          companyId: context.companyId,
          timesheetId: week.id,
          memberId: context.membershipId,
          workDate: businessInstant(input.workDate),
          workType: input.workType,
          projectId: refs.projectId,
          taskId: refs.taskId,
          minutes: input.minutes,
          description: input.description,
          billable: billableFor(context, env.settings, input),
          overtimeFlag: input.overtimeFlag ?? false,
          createdByMemberId: context.membershipId,
        },
        select: { id: true, billable: true },
      });
      await touchWeek(tx, week.id);
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.WORKLOG_CREATED,
          entity: { type: "work_log", id: log.id },
          after: { timesheetId: week.id, workDate: input.workDate, minutes: input.minutes, workType: input.workType, projectId: refs.projectId, taskId: refs.taskId, billable: log.billable },
        },
        { tx },
      );
      return { timesheetId: week.id, workLogId: log.id };
    });
    incrementCounter(Metric.WORKLOG_CREATE_SUCCESS);
    return result;
  } catch (error) {
    incrementCounter(Metric.WORKLOG_CREATE_FAILURE);
    throw error;
  }
}

async function requireOwnLog(context: UserContext, workLogId: string) {
  const log = await prisma.workLog.findFirst({
    where: { id: workLogId, companyId: context.companyId, memberId: context.membershipId },
    select: { id: true, timesheetId: true, workDate: true, minutes: true, workType: true, projectId: true, taskId: true, description: true, billable: true, overtimeFlag: true, updatedAt: true, timesheet: { select: { status: true } } },
  });
  if (!log) throw fail("WORKLOG_NOT_FOUND", "That entry could not be found.", "NOT_FOUND");
  if (!isEditableStatus(log.timesheet.status)) throw lockedError(log.timesheet.status);
  return log;
}

export async function updateWorkLog(context: UserContext, workLogId: string, sent: WorkLogUpdateInput): Promise<{ timesheetId: string; workLogId: string }> {
  assertOwnTime(context);
  const log = await requireOwnLog(context, workLogId);
  // Absent keeps what the entry has (AUD-09 §4, FV-05); a task goes with its project, so a new project without a task drops the old task.
  const projectId = sent.projectId === undefined ? log.projectId : sent.projectId;
  const input = {
    ...sent,
    projectId,
    taskId: sent.taskId !== undefined ? sent.taskId : projectId === log.projectId ? log.taskId : null,
    description: sent.description === undefined ? log.description : sent.description,
    overtimeFlag: sent.overtimeFlag ?? log.overtimeFlag,
  };
  if (input.updatedAt && new Date(input.updatedAt).getTime() !== log.updatedAt.getTime()) {
    throw fail("WORKLOG_CHANGED", "This entry changed in another window. Reload to see it.", "CONFLICT");
  }
  const env = await environment(context);
  const refs = await assertEntry(context, env, input, { excludeLogIds: [log.id] });
  return prisma.$transaction(async (tx) => {
    // Moving an entry to another week moves it onto that week, which must be editable too.
    const week = await ensureWeek(tx, context, env.settings, input.workDate);
    if (!isEditableStatus(week.status)) throw lockedError(week.status);
    await tx.workLog.update({
      where: { id: log.id },
      data: {
        timesheetId: week.id,
        workDate: businessInstant(input.workDate),
        workType: input.workType,
        projectId: refs.projectId,
        taskId: refs.taskId,
        minutes: input.minutes,
        description: input.description,
        billable: billableFor(context, env.settings, input, input.workType === log.workType ? log.billable : undefined),
        overtimeFlag: input.overtimeFlag ?? log.overtimeFlag,
      },
    });
    await touchWeek(tx, week.id);
    if (week.id !== log.timesheetId) await touchWeek(tx, log.timesheetId);
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.WORKLOG_UPDATED,
        entity: { type: "work_log", id: log.id },
        before: { workDate: log.workDate.toISOString().slice(0, 10), minutes: log.minutes, workType: log.workType, projectId: log.projectId, taskId: log.taskId, billable: log.billable, overtimeFlag: log.overtimeFlag },
        after: { workDate: input.workDate, minutes: input.minutes, workType: input.workType, projectId: refs.projectId, taskId: refs.taskId, overtimeFlag: input.overtimeFlag ?? log.overtimeFlag },
      },
      { tx },
    );
    return { timesheetId: week.id, workLogId: log.id };
  });
}

/** A draft entry may simply go: it was never submitted evidence (§115). */
export async function deleteWorkLog(context: UserContext, workLogId: string): Promise<{ timesheetId: string }> {
  assertOwnTime(context);
  const log = await requireOwnLog(context, workLogId);
  await prisma.$transaction(async (tx) => {
    await tx.workLog.delete({ where: { id: log.id } });
    await touchWeek(tx, log.timesheetId);
    await recordUserAction(
      context,
      { actionKey: AuditAction.WORKLOG_ARCHIVED, entity: { type: "work_log", id: log.id }, before: { timesheetId: log.timesheetId, workDate: log.workDate.toISOString().slice(0, 10), minutes: log.minutes } },
      { tx },
    );
  });
  return { timesheetId: log.timesheetId };
}

/**
 * One grid cell (§43, §47): the total for a row on a day. One entry is
 * updated, none is created, zero removes it. A day with several entries on the
 * same row is edited entry by entry, so a quick grid edit never merges or
 * discards what somebody described separately.
 */
export async function setCell(context: UserContext, input: CellInput): Promise<{ timesheetId: string | null }> {
  assertOwnTime(context);
  const env = await environment(context);
  const periodStart = weekStartOf(input.workDate, env.settings.weekStartsOn);
  const week = await prisma.timesheet.findUnique({
    where: { companyId_memberId_periodStart: { companyId: context.companyId, memberId: context.membershipId, periodStart: businessInstant(periodStart) } },
    select: { id: true, status: true },
  });
  if (week && !isEditableStatus(week.status)) throw lockedError(week.status);

  const logs = week
    ? await prisma.workLog.findMany({
        where: { timesheetId: week.id, workDate: businessInstant(input.workDate), workType: input.workType, projectId: input.projectId, taskId: input.taskId },
        select: { id: true, minutes: true, description: true, billable: true, overtimeFlag: true, updatedAt: true },
      })
    : [];

  if (logs.length > 1) throw fail("TIMESHEET_CELL_HAS_ENTRIES", "This day has several entries on this row. Change them one by one.", "CONFLICT");
  const [log] = logs;
  if (input.minutes === 0) {
    if (log) await deleteWorkLog(context, log.id);
    return { timesheetId: week?.id ?? null };
  }
  if (log) {
    const result = await updateWorkLog(context, log.id, {
      workDate: input.workDate,
      workType: input.workType,
      projectId: input.projectId,
      taskId: input.taskId,
      minutes: input.minutes,
      description: log.description,
      overtimeFlag: log.overtimeFlag,
    });
    return { timesheetId: result.timesheetId };
  }
  const result = await createWorkLog(context, { workDate: input.workDate, workType: input.workType, projectId: input.projectId, taskId: input.taskId, minutes: input.minutes, description: null, overtimeFlag: false });
  return { timesheetId: result.timesheetId };
}

export type RowTemplate = {
  workType: WorkLogType;
  projectId: string | null;
  taskId: string | null;
  project: { id: string; name: string; code: string | null } | null;
  task: { id: string; title: string } | null;
};

/**
 * Last week's rows, to start this one (§51). Without durations it only returns
 * the rows — projects, tasks and work types — for the grid to show empty;
 * with them, each entry is copied onto the same weekday wherever the rules
 * still allow it, and the rest are reported rather than forced.
 */
export async function copyPreviousWeek(context: UserContext, input: { week: string; withDurations: boolean }): Promise<{ rows: RowTemplate[]; copied: number; skipped: number }> {
  assertOwnTime(context);
  const env = await environment(context);
  const targetStart = weekStartOf(input.week, env.settings.weekStartsOn);
  const sourceStart = addLocalDays(targetStart, -7);
  const logs = await prisma.workLog.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId, workDate: { gte: businessInstant(sourceStart), lte: businessInstant(addLocalDays(sourceStart, 6)) } },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
    select: {
      workDate: true, workType: true, projectId: true, taskId: true, minutes: true, description: true, billable: true,
      project: { select: { id: true, name: true, code: true, archivedAt: true } },
      task: { select: { id: true, title: true, archivedAt: true } },
    },
  });
  const seen = new Map<string, RowTemplate>();
  for (const log of logs) {
    // Rows for archived work are not offered again (§227, §228).
    if (log.project?.archivedAt || log.task?.archivedAt) continue;
    seen.set(`${log.workType}|${log.projectId ?? ""}|${log.taskId ?? ""}`, {
      workType: log.workType,
      projectId: log.projectId,
      taskId: log.taskId,
      project: log.project ? { id: log.project.id, name: log.project.name, code: log.project.code } : null,
      task: log.task ? { id: log.task.id, title: log.task.title } : null,
    });
  }
  if (!input.withDurations) return { rows: [...seen.values()], copied: 0, skipped: 0 };

  let copied = 0;
  let skipped = 0;
  for (const log of logs) {
    const date = addLocalDays(log.workDate.toISOString().slice(0, 10), 7);
    try {
      await createWorkLog(context, { workDate: date, workType: log.workType, projectId: log.projectId, taskId: log.taskId, minutes: log.minutes, description: log.description, billable: log.billable, overtimeFlag: false });
      copied += 1;
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      skipped += 1;
    }
  }
  return { rows: [...seen.values()], copied, skipped };
}

/** Copies one day's entries onto another day of a draft week (§50). */
export async function copyDay(context: UserContext, input: { from: string; to: string }): Promise<{ copied: number; skipped: number }> {
  assertOwnTime(context);
  if (input.from === input.to) throw fail("TIMESHEET_INVALID_DATE", "Choose a different day to copy to.");
  const logs = await prisma.workLog.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId, workDate: businessInstant(input.from) },
    orderBy: { createdAt: "asc" },
    select: { workType: true, projectId: true, taskId: true, minutes: true, description: true, billable: true },
  });
  let copied = 0;
  let skipped = 0;
  for (const log of logs) {
    try {
      await createWorkLog(context, { workDate: input.to, workType: log.workType, projectId: log.projectId, taskId: log.taskId, minutes: log.minutes, description: log.description, billable: log.billable, overtimeFlag: false });
      copied += 1;
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      skipped += 1;
    }
  }
  return { copied, skipped };
}

export { weekDays };
