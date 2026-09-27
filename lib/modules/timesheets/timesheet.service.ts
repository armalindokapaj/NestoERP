import type { Prisma, TimesheetStatus } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { delegationsTo } from "@/lib/core/approvals/approval-delegations";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { leaveTypeLabels } from "@/lib/modules/hr/hr.status";
import { resolveApprover } from "./timesheet.approvers";
import { isEditableStatus, MODULE, readableTimesheetWhere, timesheetsOpen } from "./timesheet.permissions";
import { resolveTimesheetSettings } from "./timesheet.settings";
import { addLocalDays, businessInstant, dateOf, daysBetween, formatMinutes, isoWeekday, weekDays, weekLabel, weekStartOf } from "./timesheet.time";
import type {
  TimesheetDayDTO,
  TimesheetFormOptions,
  TimesheetHistoryEntry,
  TimesheetPerson,
  TimesheetRowDTO,
  TimesheetSettingsDTO,
  TimesheetTotals,
  TimesheetWarning,
  TimesheetWeekDTO,
  WorkLogDTO,
} from "./timesheet.types";

/**
 * Reading a week (PRD #42 §32-§36, §43, §55-§57, §79, §96-§99, §183, §211).
 *
 * One read builds everything the week screen, the review drawer and the
 * mobile day cards show: the grid rows, daily and weekly totals, what was
 * expected once approved leave is taken out, how the logged time compares with
 * attendance, warnings, and the decision history. Totals are sums of whole
 * minutes; overtime is informational — above the standard week, never pay.
 */

const LOG_SELECT = {
  id: true,
  workDate: true,
  workType: true,
  minutes: true,
  description: true,
  billable: true,
  overtimeFlag: true,
  updatedAt: true,
  project: { select: { id: true, name: true, code: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.WorkLogSelect;

type LogRow = Prisma.WorkLogGetPayload<{ select: typeof LOG_SELECT }>;

const LONG_DAY_MINUTES = 12 * 60;

function logDTO(row: LogRow): WorkLogDTO {
  return {
    id: row.id,
    workDate: dateOf(row.workDate),
    workType: row.workType,
    minutes: row.minutes,
    description: row.description,
    billable: row.billable,
    overtimeFlag: row.overtimeFlag,
    project: row.project ? { id: row.project.id, name: row.project.name, code: row.project.code } : null,
    task: row.task ? { id: row.task.id, title: row.task.title } : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function rowKey(log: { workType: string; projectId?: string | null; taskId?: string | null; project?: { id: string } | null; task?: { id: string } | null }): string {
  return `${log.workType}|${log.projectId ?? log.project?.id ?? ""}|${log.taskId ?? log.task?.id ?? ""}`;
}

async function names(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, TimesheetPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, { memberId: row.id, name: `${row.user.firstName} ${row.user.lastName}` }]));
}

/** Summaries of a set of logs, shared by the week, the review drawer and the team list. */
export function summarise(logs: WorkLogDTO[], settings: TimesheetSettingsDTO, leaveWorkingDays: number): TimesheetTotals {
  const total = logs.reduce((sum, log) => sum + log.minutes, 0);
  const billable = logs.filter((log) => log.billable).reduce((sum, log) => sum + log.minutes, 0);
  const projects = new Map<string, { projectId: string | null; name: string; minutes: number }>();
  for (const log of logs) {
    const key = log.project?.id ?? "__internal";
    const entry = projects.get(key) ?? { projectId: log.project?.id ?? null, name: log.project?.name ?? "Internal and other work", minutes: 0 };
    entry.minutes += log.minutes;
    projects.set(key, entry);
  }
  return {
    totalMinutes: total,
    billableMinutes: billable,
    nonBillableMinutes: total - billable,
    internalMinutes: logs.filter((log) => !log.project).reduce((sum, log) => sum + log.minutes, 0),
    overtimeFlaggedMinutes: logs.filter((log) => log.overtimeFlag).reduce((sum, log) => sum + log.minutes, 0),
    overtimeMinutes: Math.max(0, total - settings.standardWeeklyMinutes),
    expectedMinutes: Math.max(0, settings.standardWeeklyMinutes - leaveWorkingDays * settings.standardDailyMinutes),
    projects: [...projects.values()].sort((a, b) => b.minutes - a.minutes),
  };
}

export function buildRows(logs: WorkLogDTO[]): TimesheetRowDTO[] {
  const rows = new Map<string, TimesheetRowDTO>();
  for (const log of logs) {
    const key = rowKey(log);
    const row = rows.get(key) ?? { key, workType: log.workType, project: log.project, task: log.task, days: {}, totalMinutes: 0, billableMinutes: 0 };
    const cell = row.days[log.workDate] ?? { minutes: 0, logIds: [] };
    cell.minutes += log.minutes;
    cell.logIds.push(log.id);
    row.days[log.workDate] = cell;
    row.totalMinutes += log.minutes;
    if (log.billable) row.billableMinutes += log.minutes;
    rows.set(key, row);
  }
  // Projects first, then internal work, each alphabetically (§192).
  return [...rows.values()].sort((a, b) => Number(!a.project) - Number(!b.project) || (a.project?.name ?? a.workType).localeCompare(b.project?.name ?? b.workType) || (a.task?.title ?? "").localeCompare(b.task?.title ?? ""));
}

type TimesheetRow = Prisma.TimesheetGetPayload<{
  select: {
    id: true; memberId: true; periodStart: true; status: true; version: true; submissionVersion: true; approverMemberId: true;
    submittedAt: true; approvedAt: true; approvedByMemberId: true; returnedAt: true; returnedByMemberId: true; rejectedAt: true; rejectedByMemberId: true; decisionNote: true;
  };
}>;

const TIMESHEET_SELECT = {
  id: true, memberId: true, periodStart: true, status: true, version: true, submissionVersion: true, approverMemberId: true,
  submittedAt: true, approvedAt: true, approvedByMemberId: true, returnedAt: true, returnedByMemberId: true, rejectedAt: true, rejectedByMemberId: true, decisionNote: true,
} as const;

async function buildWeek(context: UserContext, input: { memberId: string; periodStart: string; timesheet: TimesheetRow | null; settings: TimesheetSettingsDTO }): Promise<TimesheetWeekDTO> {
  const { memberId, periodStart, timesheet, settings } = input;
  const today = localDate(new Date(), settings.timezone);
  const days = weekDays(periodStart);
  const periodEnd = days[6];
  const own = memberId === context.membershipId;

  const [logRows, leave, attendance, cycles, reopens] = await Promise.all([
    timesheet ? prisma.workLog.findMany({ where: { timesheetId: timesheet.id }, orderBy: [{ workDate: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: LOG_SELECT }) : Promise.resolve([]),
    prisma.leaveRequest.findMany({
      where: { companyId: context.companyId, companyMemberId: memberId, status: "APPROVED", startDate: { lt: new Date(`${addLocalDays(periodEnd, 1)}T00:00:00.000Z`) }, endDate: { gte: new Date(`${periodStart}T00:00:00.000Z`) } },
      select: { leaveType: true, startDate: true, endDate: true },
    }),
    (own && can(context, "hr.self.attendance")) || can(context, "hr.attendance.view")
      ? prisma.attendanceRecord.findMany({
          where: { companyId: context.companyId, companyMemberId: memberId, date: { gte: new Date(`${periodStart}T00:00:00.000Z`), lt: new Date(`${addLocalDays(periodEnd, 1)}T00:00:00.000Z`) } },
          select: { date: true, workedMinutes: true },
        })
      : Promise.resolve(null),
    timesheet
      ? prisma.timesheetApproval.findMany({ where: { recordId: timesheet.id }, orderBy: { submittedAt: "asc" }, select: { id: true, status: true, submittedAt: true, submittedByMemberId: true, decidedAt: true, decidedByMemberId: true, decisionNote: true, approverMemberId: true } })
      : Promise.resolve([]),
    timesheet
      ? prisma.activity.findMany({ where: { companyId: context.companyId, entityType: "Timesheet", entityId: timesheet.id, action: "TIMESHEET_REOPENED" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, actorMemberId: true, metadata: true } })
      : Promise.resolve([]),
  ]);

  const logs = logRows.map(logDTO);
  const people = await names(context.companyId, [memberId, timesheet?.approverMemberId, timesheet?.approvedByMemberId, timesheet?.returnedByMemberId, timesheet?.rejectedByMemberId, ...cycles.flatMap((cycle) => [cycle.submittedByMemberId, cycle.decidedByMemberId]), ...reopens.map((row) => row.actorMemberId)]);

  // Leave is shown to the member as its type; to anybody else only as "Leave" (§96, HR privacy).
  const leaveDays = new Map<string, string>();
  for (const request of leave) {
    for (const day of days) {
      if (day >= dateOf(request.startDate) && day <= dateOf(request.endDate)) leaveDays.set(day, own ? leaveTypeLabels[request.leaveType] : "Leave");
    }
  }
  const workingDays = await prisma.companySettings.findUnique({ where: { companyId: context.companyId }, select: { workingDays: true } });
  const working = new Set(workingDays?.workingDays ?? [1, 2, 3, 4, 5]);
  const leaveWorkingDays = [...leaveDays.keys()].filter((day) => working.has(isoWeekday(day))).length;

  const attendanceByDay = new Map<string, number>();
  for (const row of attendance ?? []) attendanceByDay.set(dateOf(row.date), (attendanceByDay.get(dateOf(row.date)) ?? 0) + (row.workedMinutes ?? 0));

  const dayDTOs: TimesheetDayDTO[] = days.map((date) => ({
    date,
    totalMinutes: logs.filter((log) => log.workDate === date).reduce((sum, log) => sum + log.minutes, 0),
    leave: leaveDays.has(date) ? { label: leaveDays.get(date)! } : null,
    attendanceMinutes: attendance ? (attendanceByDay.get(date) ?? null) : null,
    future: date > today,
    locked: daysBetween(date, today) > settings.backdateDays && !(timesheet && (timesheet.status === "RETURNED" || timesheet.status === "REJECTED")),
  }));

  const totals = summarise(logs, settings, leaveWorkingDays);
  const status = timesheet?.status ?? "DRAFT";
  const editable = isEditableStatus(status);

  const warnings: TimesheetWarning[] = [];
  for (const day of dayDTOs) {
    if (day.totalMinutes > LONG_DAY_MINUTES) warnings.push({ code: "LONG_DAY", message: `${formatMinutes(day.totalMinutes)} logged on ${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(businessInstant(day.date))}.`, severity: "WARNING" });
    if (day.attendanceMinutes !== null && day.attendanceMinutes - day.totalMinutes >= 60 && day.date <= today) {
      warnings.push({ code: "ATTENDANCE_DIFFERENCE", message: `Attendance shows ${formatMinutes(day.attendanceMinutes)} on ${day.date}, with ${formatMinutes(day.totalMinutes)} logged.`, severity: "INFO" });
    }
  }
  if (settings.descriptionsRequired) {
    const missing = logs.filter((log) => !log.description?.trim()).length;
    if (missing > 0) warnings.push({ code: "DESCRIPTIONS_MISSING", message: `${missing} ${missing === 1 ? "entry is" : "entries are"} missing a description.`, severity: "WARNING" });
  }
  if (logs.length > 0 && totals.totalMinutes < totals.expectedMinutes && periodEnd <= today) {
    warnings.push({ code: "BELOW_EXPECTED", message: `${formatMinutes(totals.expectedMinutes - totals.totalMinutes)} below the expected ${formatMinutes(totals.expectedMinutes)}.`, severity: "INFO" });
  }

  const history: TimesheetHistoryEntry[] = [];
  cycles.forEach((cycle, index) => {
    history.push({ id: `${cycle.id}:submitted`, action: index === 0 ? "Submitted" : "Resubmitted", actorName: people.get(cycle.submittedByMemberId)?.name ?? null, actorMemberId: people.has(cycle.submittedByMemberId) ? cycle.submittedByMemberId : null, occurredAt: cycle.submittedAt.toISOString(), note: null, tone: "info" });
    if (cycle.status !== "PENDING" && cycle.decidedAt) {
      const action = cycle.status === "APPROVED" ? "Approved" : cycle.status === "RETURNED" ? "Returned" : cycle.status === "REJECTED" ? "Rejected" : "Withdrawn";
      const tone = cycle.status === "APPROVED" ? "success" : cycle.status === "REJECTED" ? "danger" : cycle.status === "RETURNED" ? "warning" : "neutral";
      history.push({ id: `${cycle.id}:decided`, action, actorName: cycle.decidedByMemberId ? (people.get(cycle.decidedByMemberId)?.name ?? null) : null, actorMemberId: cycle.decidedByMemberId && people.has(cycle.decidedByMemberId) ? cycle.decidedByMemberId : null, occurredAt: cycle.decidedAt.toISOString(), note: cycle.decisionNote, tone });
    }
  });
  for (const reopen of reopens) {
    history.push({ id: reopen.id, action: "Reopened", actorName: reopen.actorMemberId ? (people.get(reopen.actorMemberId)?.name ?? null) : null, actorMemberId: reopen.actorMemberId && people.has(reopen.actorMemberId) ? reopen.actorMemberId : null, occurredAt: reopen.createdAt.toISOString(), note: (reopen.metadata as { note?: string } | null)?.note ?? null, tone: "warning" });
  }
  history.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const pendingCycle = cycles.find((cycle) => cycle.status === "PENDING");
  let approvalHref: string | null = null;
  if (pendingCycle && can(context, "timesheet.approve") && !own) {
    const lent = pendingCycle.approverMemberId === context.membershipId ? [] : await delegationsTo(context.companyId, context.membershipId, "timesheets");
    if (pendingCycle.approverMemberId === context.membershipId || lent.some((row) => row.fromMemberId === pendingCycle.approverMemberId)) {
      approvalHref = `/approvals?approval=timesheets%3A${pendingCycle.id}`;
    }
  }

  const decidedBy = timesheet?.approvedByMemberId ?? timesheet?.returnedByMemberId ?? timesheet?.rejectedByMemberId ?? null;
  const decidedAt = status === "APPROVED" ? timesheet?.approvedAt : status === "RETURNED" ? timesheet?.returnedAt : status === "REJECTED" ? timesheet?.rejectedAt : null;

  return {
    id: timesheet?.id ?? null,
    member: people.get(memberId) ?? { memberId, name: "Former member" },
    periodStart,
    periodEnd,
    today,
    status,
    version: timesheet?.version ?? 1,
    submissionVersion: timesheet?.submissionVersion ?? 0,
    approver: timesheet?.approverMemberId ? (people.get(timesheet.approverMemberId) ?? null) : null,
    expectedApprover: own && editable ? await resolveApprover(context.companyId, memberId).then((row) => (row ? { memberId: row.memberId, name: row.name } : null)) : null,
    submittedAt: timesheet?.submittedAt?.toISOString() ?? null,
    decidedAt: decidedAt?.toISOString() ?? null,
    decidedBy: decidedBy ? (people.get(decidedBy) ?? null) : null,
    decisionNote: timesheet?.decisionNote ?? null,
    days: dayDTOs,
    rows: buildRows(logs),
    logs,
    totals,
    warnings,
    history,
    settings,
    capabilities: {
      canEdit: own && can(context, "timesheet.edit_own") && editable,
      canSubmit: own && can(context, "timesheet.submit_own") && editable && logs.length > 0,
      canReopen: !own && can(context, "timesheet.reopen") && status === "APPROVED",
      canSetBillable: settings.membersSetBillable || can(context, "timesheet.approve"),
      canComment: Boolean(timesheet),
      approvalHref,
      isOwn: own,
    },
  };
}

/** The signed-in member's week (§5, §43, §144). */
export async function getMyWeek(context: UserContext, input: { week?: string } = {}): Promise<TimesheetWeekDTO> {
  assertModule(context, MODULE);
  if (!timesheetsOpen(context)) throw new AccessError("FORBIDDEN");
  const started = Date.now();
  const settings = await resolveTimesheetSettings(context.companyId);
  const today = localDate(new Date(), settings.timezone);
  const periodStart = weekStartOf(input.week ?? today, settings.weekStartsOn);
  const timesheet = await prisma.timesheet.findUnique({
    where: { companyId_memberId_periodStart: { companyId: context.companyId, memberId: context.membershipId, periodStart: businessInstant(periodStart) } },
    select: TIMESHEET_SELECT,
  });
  const week = await buildWeek(context, { memberId: context.membershipId, periodStart, timesheet, settings });
  incrementCounter(Metric.TIMESHEET_LOAD_DURATION_MS, { view: "me" }, Date.now() - started);
  return week;
}

/** Any week this reader may open: their own, one they approve, or one in their team scope (§122-§125). */
export async function getTimesheet(context: UserContext, timesheetId: string): Promise<TimesheetWeekDTO> {
  assertModule(context, MODULE);
  if (!timesheetsOpen(context)) throw new AccessError("FORBIDDEN");
  const timesheet = await prisma.timesheet.findFirst({ where: { AND: [await readableTimesheetWhere(context), { id: timesheetId }] }, select: TIMESHEET_SELECT });
  if (!timesheet) throw new AccessError("NOT_FOUND", "That timesheet could not be found.", { code: "TIMESHEET_NOT_FOUND" });
  const settings = await resolveTimesheetSettings(context.companyId);
  return buildWeek(context, { memberId: timesheet.memberId, periodStart: dateOf(timesheet.periodStart), timesheet, settings });
}

/** Projects the member can log time to, and the rows they used most recently (§53, §186). */
export async function timesheetFormOptions(context: UserContext): Promise<TimesheetFormOptions> {
  assertModule(context, MODULE);
  const projects =
    canAccessModule(context, "projects") && can(context, "project.view")
      ? await prisma.project.findMany({ where: { AND: [buildProjectScopeWhere(context), { archivedAt: null }] }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, code: true } })
      : [];
  const recentLogs = await prisma.workLog.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { workType: true, project: { select: { id: true, name: true, code: true, archivedAt: true } }, task: { select: { id: true, title: true, archivedAt: true } } },
  });
  const recent: TimesheetFormOptions["recent"] = [];
  const seen = new Set<string>();
  for (const log of recentLogs) {
    if (log.project?.archivedAt || log.task?.archivedAt) continue;
    const key = `${log.workType}|${log.project?.id ?? ""}|${log.task?.id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push({ workType: log.workType, project: log.project ? { id: log.project.id, name: log.project.name, code: log.project.code } : null, task: log.task ? { id: log.task.id, title: log.task.title } : null });
    if (recent.length >= 6) break;
  }
  return { projects, recent };
}

/** Tasks on a project the member can open, for the task picker (§54). */
export async function taskOptions(context: UserContext, projectId: string, q?: string) {
  assertModule(context, MODULE);
  if (!canAccessModule(context, "tasks") || !can(context, "task.view")) return [];
  const { buildTaskScopeWhere } = await import("@/lib/access/scope");
  return prisma.task.findMany({
    where: { AND: [buildTaskScopeWhere(context), { projectId, archivedAt: null, status: { not: "ARCHIVED" } }, q ? { title: { contains: q.slice(0, 80), mode: "insensitive" } } : {}] },
    orderBy: [{ status: "asc" }, { title: "asc" }],
    take: 40,
    select: { id: true, title: true, status: true },
  });
}

/** The member's latest weeks, newest first, for the dashboard (§183). */
export async function myRecentWeeks(context: UserContext, count: number) {
  if (!timesheetsOpen(context)) return [];
  const settings = await resolveTimesheetSettings(context.companyId);
  const current = weekStartOf(localDate(new Date(), settings.timezone), settings.weekStartsOn);
  const starts = Array.from({ length: count }, (_, index) => addLocalDays(current, -7 * index));
  const rows = await prisma.timesheet.findMany({
    where: { companyId: context.companyId, memberId: context.membershipId, periodStart: { in: starts.map(businessInstant) } },
    select: { id: true, periodStart: true, status: true },
  });
  const sums = rows.length ? await prisma.workLog.groupBy({ by: ["timesheetId"], where: { timesheetId: { in: rows.map((row) => row.id) } }, _sum: { minutes: true } }) : [];
  const minutes = new Map(sums.map((row) => [row.timesheetId, row._sum.minutes ?? 0]));
  const byStart = new Map(rows.map((row) => [dateOf(row.periodStart), row]));
  return starts.map((start, index) => {
    const row = byStart.get(start);
    const total = row ? (minutes.get(row.id) ?? 0) : 0;
    return {
      periodStart: start,
      label: weekLabel(start),
      status: (row?.status ?? "DRAFT") as TimesheetStatus,
      totalMinutes: total,
      totalLabel: formatMinutes(total),
      expectedMinutes: settings.standardWeeklyMinutes,
      expectedLabel: formatMinutes(settings.standardWeeklyMinutes),
      href: index === 0 ? "/timesheets" : `/timesheets?week=${start}`,
    };
  });
}

export const statusOrder: Record<TimesheetStatus, number> = { SUBMITTED: 0, RETURNED: 1, REJECTED: 2, DRAFT: 3, APPROVED: 4, CANCELLED: 5 };

export { TIMESHEET_SELECT, addLocalDays, weekLabel };
