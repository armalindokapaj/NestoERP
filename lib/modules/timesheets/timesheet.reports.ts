import type { Prisma } from "@prisma/client";
import type { z } from "zod";

import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";
import { can } from "@/lib/access/can";
import { AccessError, assertModule } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import { MODULE, projectLogWhere, seesEntryDetail, teamMemberWhere, timesheetsOpen } from "./timesheet.permissions";
import type { projectSummaryQuerySchema, teamQuerySchema } from "./timesheet.schema";
import { statusOrder } from "./timesheet.service";
import { resolveTimesheetSettings } from "./timesheet.settings";
import { addLocalDays, businessInstant, dateOf, daysBetween, weekEndOf, weekLabel, weekStartOf } from "./timesheet.time";
import type { ProjectTimeSummaryDTO, TeamTimesheetListDTO, TeamTimesheetRowDTO, TimesheetPerson, TimesheetStatus } from "./timesheet.types";

/**
 * Team and project reading (PRD #42 §87-§92, §123-§126, §153, §154, §170-§178,
 * §271, §272).
 *
 * Both are aggregated in the database — sums grouped by week, member, task and
 * day — so a manager's list or a project's hours never loads every entry to
 * add them up. Project reporting counts approved weeks unless asked otherwise,
 * shows hours to anybody who may report on the project, and what people wrote
 * only to team readers. Nothing here scores anybody (§174).
 */

const TEAM_LIMIT = 500;
const ENTRY_LIMIT = 200;
const RANGE_LIMIT_DAYS = 366;

function person(row: { id: string; user: { firstName: string; lastName: string } }): TimesheetPerson {
  return { memberId: row.id, name: `${row.user.firstName} ${row.user.lastName}` };
}

const TEAM_ORDER: Record<TimesheetStatus | "NOT_STARTED", number> = { ...statusOrder, NOT_STARTED: 3.5 };

/** Roles that keep timesheets at all: a Viewer on the project is not "not started" (§127). */
const TIMESHEET_ROLES = ROLE_KEYS.filter((role) => (permissionsForRole(role) as readonly string[]).includes("timesheet.submit_own"));

/** Everyone whose week this reader oversees, for one week (§87-§89, §153). */
export async function listTeamTimesheets(context: UserContext, query: z.infer<typeof teamQuerySchema>): Promise<TeamTimesheetListDTO> {
  assertModule(context, MODULE);
  if (!timesheetsOpen(context) || !(can(context, "timesheet.team.view") || can(context, "timesheet.approve"))) throw new AccessError("FORBIDDEN");
  const started = Date.now();
  const settings = await resolveTimesheetSettings(context.companyId);
  const periodStart = weekStartOf(query.week ?? localDate(new Date(), settings.timezone), settings.weekStartsOn);
  const instant = businessInstant(periodStart);

  const doors: Prisma.CompanyMemberWhereInput[] = [];
  const team = teamMemberWhere(context);
  if (team) doors.push(team);
  if (can(context, "timesheet.approve")) {
    doors.push({ timesheetApprover: { is: { approverMemberId: context.membershipId } } });
    doors.push({ timesheets: { some: { periodStart: instant, approverMemberId: context.membershipId } } });
  }
  if (doors.length === 0) throw new AccessError("FORBIDDEN");

  const members = await prisma.companyMember.findMany({
    where: {
      AND: [
        { companyId: context.companyId, status: "ACTIVE", id: { not: context.membershipId }, role: { key: { in: TIMESHEET_ROLES } }, OR: doors },
        query.departmentId ? { departmentId: query.departmentId } : {},
        query.memberId ? { id: query.memberId } : {},
        query.q
          ? { OR: [{ user: { firstName: { contains: query.q, mode: "insensitive" } } }, { user: { lastName: { contains: query.q, mode: "insensitive" } } }, { jobTitle: { contains: query.q, mode: "insensitive" } }] }
          : {},
      ],
    },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    take: TEAM_LIMIT + 1,
    select: {
      id: true,
      jobTitle: true,
      user: { select: { firstName: true, lastName: true } },
      department: { select: { id: true, name: true, managerMemberId: true } },
      timesheetApprover: { select: { approverMemberId: true } },
    },
  });
  const truncated = members.length > TEAM_LIMIT;
  const visible = members.slice(0, TEAM_LIMIT);
  const memberIds = visible.map((row) => row.id);

  const weeks = await prisma.timesheet.findMany({
    where: { companyId: context.companyId, periodStart: instant, memberId: { in: memberIds } },
    select: { id: true, memberId: true, status: true, submittedAt: true, approverMemberId: true },
  });
  const sums = weeks.length
    ? await prisma.workLog.groupBy({
        by: ["timesheetId", "billable"],
        where: { timesheetId: { in: weeks.map((week) => week.id) } },
        _sum: { minutes: true },
      })
    : [];
  const minutes = new Map<string, { total: number; billable: number }>();
  for (const sum of sums) {
    const entry = minutes.get(sum.timesheetId) ?? { total: 0, billable: 0 };
    entry.total += sum._sum.minutes ?? 0;
    if (sum.billable) entry.billable += sum._sum.minutes ?? 0;
    minutes.set(sum.timesheetId, entry);
  }
  const weekByMember = new Map(weeks.map((week) => [week.memberId, week]));

  // The approver shown is the one a submitted week went to, or the one it would go to (§72).
  const approverIds = new Set<string>();
  const approverOf = (member: (typeof visible)[number]): string | null => {
    const week = weekByMember.get(member.id);
    const id = week?.approverMemberId ?? member.timesheetApprover?.approverMemberId ?? (member.department?.managerMemberId !== member.id ? member.department?.managerMemberId : null) ?? null;
    if (id) approverIds.add(id);
    return id;
  };
  const approverIdByMember = new Map(visible.map((member) => [member.id, approverOf(member)]));
  const approverRows = approverIds.size
    ? await prisma.companyMember.findMany({ where: { companyId: context.companyId, id: { in: [...approverIds] } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } })
    : [];
  const approvers = new Map(approverRows.map((row) => [row.id, person(row)]));

  let rows: TeamTimesheetRowDTO[] = visible.map((member) => {
    const week = weekByMember.get(member.id);
    const sum = week ? (minutes.get(week.id) ?? { total: 0, billable: 0 }) : { total: 0, billable: 0 };
    const approverId = approverIdByMember.get(member.id);
    return {
      timesheetId: week?.id ?? null,
      member: { ...person(member), jobTitle: member.jobTitle, department: member.department?.name ?? null },
      periodStart,
      status: week?.status ?? "NOT_STARTED",
      totalMinutes: sum.total,
      billableMinutes: sum.billable,
      overtimeMinutes: Math.max(0, sum.total - settings.standardWeeklyMinutes),
      submittedAt: week?.submittedAt?.toISOString() ?? null,
      approver: approverId ? (approvers.get(approverId) ?? null) : null,
      href: week ? `/timesheets/${week.id}` : null,
    };
  });

  const counts = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, RETURNED: 0, REJECTED: 0, CANCELLED: 0, NOT_STARTED: 0 } satisfies TeamTimesheetListDTO["counts"];
  if (query.approverMemberId) rows = rows.filter((row) => row.approver?.memberId === query.approverMemberId);
  for (const row of rows) counts[row.status] += 1;
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  rows.sort((a, b) => TEAM_ORDER[a.status] - TEAM_ORDER[b.status] || (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "") || a.member.name.localeCompare(b.member.name));

  const departments = new Map<string, string>();
  for (const member of visible) if (member.department) departments.set(member.department.id, member.department.name);

  incrementCounter(Metric.TIMESHEET_LOAD_DURATION_MS, { view: "team" }, Date.now() - started);
  return {
    periodStart,
    periodEnd: weekEndOf(periodStart),
    weekLabel: weekLabel(periodStart),
    rows,
    counts,
    departments: [...departments].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    approvers: [...approvers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    truncated,
  };
}

/** Hours on projects this reader may report on (§90-§92, §154, §170-§178). */
export async function projectTimeSummary(context: UserContext, query: z.infer<typeof projectSummaryQuerySchema>): Promise<ProjectTimeSummaryDTO> {
  assertModule(context, MODULE);
  const scope = timesheetsOpen(context) ? projectLogWhere(context) : null;
  if (!scope) throw new AccessError("FORBIDDEN");
  const started = Date.now();
  const settings = await resolveTimesheetSettings(context.companyId);
  const today = localDate(new Date(), settings.timezone);
  let to = query.to ?? weekEndOf(weekStartOf(today, settings.weekStartsOn));
  let from = query.from ?? addLocalDays(weekStartOf(today, settings.weekStartsOn), -21);
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > RANGE_LIMIT_DAYS) from = addLocalDays(to, -RANGE_LIMIT_DAYS);

  const projects = await prisma.project.findMany({
    where: { AND: [buildProjectScopeWhere(context), { workLogs: { some: {} } }] },
    orderBy: { name: "asc" },
    take: 300,
    select: { id: true, name: true, code: true },
  });
  const project = query.projectId ? (projects.find((row) => row.id === query.projectId) ?? null) : null;
  if (query.projectId && !project) {
    const exists = await prisma.project.count({ where: { AND: [buildProjectScopeWhere(context), { id: query.projectId }] } });
    if (!exists) throw new AccessError("NOT_FOUND", "That project could not be found.", { code: "PROJECT_NOT_FOUND" });
  }

  const base: Prisma.WorkLogWhereInput = {
    AND: [
      scope,
      { projectId: query.projectId ? query.projectId : { not: null } },
      { workDate: { gte: businessInstant(from), lte: businessInstant(to) } },
      { timesheet: query.include === "approved" ? { status: "APPROVED" } : { status: { not: "CANCELLED" } } },
    ],
  };
  const where: Prisma.WorkLogWhereInput = {
    AND: [
      base,
      query.memberId ? { memberId: query.memberId } : {},
      query.taskId ? { taskId: query.taskId } : {},
      query.billable === "billable" ? { billable: true } : query.billable === "non_billable" ? { billable: false } : {},
    ],
  };

  const [byProjectRaw, byMemberRaw, byTaskRaw, byDayRaw, flagged, entryRows, memberOptions, taskOptions] = await Promise.all([
    prisma.workLog.groupBy({ by: ["projectId", "billable"], where, _sum: { minutes: true } }),
    prisma.workLog.groupBy({ by: ["memberId", "billable"], where, _sum: { minutes: true } }),
    prisma.workLog.groupBy({ by: ["taskId"], where, _sum: { minutes: true } }),
    prisma.workLog.groupBy({ by: ["workDate", "billable"], where, _sum: { minutes: true } }),
    prisma.workLog.aggregate({ where: { AND: [where, { overtimeFlag: true }] }, _sum: { minutes: true } }),
    prisma.workLog.findMany({
      where,
      orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
      take: ENTRY_LIMIT + 1,
      select: {
        id: true, workDate: true, workType: true, minutes: true, description: true, billable: true, overtimeFlag: true, updatedAt: true,
        project: { select: { id: true, name: true, code: true } },
        task: { select: { id: true, title: true } },
        member: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        timesheet: { select: { status: true } },
      },
    }),
    prisma.workLog.groupBy({ by: ["memberId"], where: base }),
    query.projectId ? prisma.workLog.groupBy({ by: ["taskId"], where: base }) : Promise.resolve([] as Array<{ taskId: string | null }>),
  ]);

  const nameIds = new Set<string>([...byMemberRaw.map((row) => row.memberId), ...memberOptions.map((row) => row.memberId)]);
  const taskIds = new Set<string>([...byTaskRaw, ...taskOptions].map((row) => row.taskId).filter((id): id is string => Boolean(id)));
  const [people, tasks] = await Promise.all([
    nameIds.size ? prisma.companyMember.findMany({ where: { companyId: context.companyId, id: { in: [...nameIds] } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }) : [],
    taskIds.size ? prisma.task.findMany({ where: { companyId: context.companyId, id: { in: [...taskIds] } }, select: { id: true, title: true } }) : [],
  ]);
  const personById = new Map(people.map((row) => [row.id, person(row)]));
  const taskById = new Map(tasks.map((row) => [row.id, row.title]));
  const projectById = new Map(projects.map((row) => [row.id, row]));

  let total = 0;
  let billable = 0;
  const byProject = new Map<string, ProjectTimeSummaryDTO["byProject"][number]>();
  for (const row of byProjectRaw) {
    if (!row.projectId) continue;
    const value = row._sum.minutes ?? 0;
    total += value;
    if (row.billable) billable += value;
    const known = projectById.get(row.projectId);
    const entry = byProject.get(row.projectId) ?? { projectId: row.projectId, name: known?.name ?? "Project", code: known?.code ?? null, minutes: 0, billableMinutes: 0 };
    entry.minutes += value;
    if (row.billable) entry.billableMinutes += value;
    byProject.set(row.projectId, entry);
  }

  const byMember = new Map<string, ProjectTimeSummaryDTO["byMember"][number]>();
  for (const row of byMemberRaw) {
    const value = row._sum.minutes ?? 0;
    const entry = byMember.get(row.memberId) ?? { memberId: row.memberId, name: personById.get(row.memberId)?.name ?? "Former member", minutes: 0, billableMinutes: 0 };
    entry.minutes += value;
    if (row.billable) entry.billableMinutes += value;
    byMember.set(row.memberId, entry);
  }

  const byWeek = new Map<string, ProjectTimeSummaryDTO["byWeek"][number]>();
  for (const row of byDayRaw) {
    const weekStart = weekStartOf(dateOf(row.workDate), settings.weekStartsOn);
    const value = row._sum.minutes ?? 0;
    const entry = byWeek.get(weekStart) ?? { weekStart, minutes: 0, billableMinutes: 0 };
    entry.minutes += value;
    if (row.billable) entry.billableMinutes += value;
    byWeek.set(weekStart, entry);
  }

  const detail = seesEntryDetail(context);
  const entries: ProjectTimeSummaryDTO["entries"] = entryRows.slice(0, ENTRY_LIMIT).map((row) => ({
    id: row.id,
    workDate: dateOf(row.workDate),
    workType: row.workType,
    minutes: row.minutes,
    description: detail ? row.description : null,
    billable: row.billable,
    overtimeFlag: row.overtimeFlag,
    project: row.project ? { id: row.project.id, name: row.project.name, code: row.project.code } : null,
    task: row.task ? { id: row.task.id, title: row.task.title } : null,
    updatedAt: row.updatedAt.toISOString(),
    member: person(row.member),
    status: row.timesheet.status,
  }));

  incrementCounter(Metric.TIMESHEET_LOAD_DURATION_MS, { view: "project" }, Date.now() - started);
  return {
    project,
    from,
    to,
    approvedOnly: query.include === "approved",
    billable: query.billable,
    totals: { totalMinutes: total, billableMinutes: billable, nonBillableMinutes: total - billable, overtimeFlaggedMinutes: flagged._sum.minutes ?? 0 },
    byProject: [...byProject.values()].sort((a, b) => b.minutes - a.minutes),
    byMember: [...byMember.values()].sort((a, b) => b.minutes - a.minutes),
    byTask: byTaskRaw
      .map((row) => ({ taskId: row.taskId, title: row.taskId ? (taskById.get(row.taskId) ?? "Task") : "No task", minutes: row._sum.minutes ?? 0 }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 50),
    byWeek: [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    entries,
    entriesTruncated: entryRows.length > ENTRY_LIMIT,
    showsDescriptions: detail,
    projects,
    members: memberOptions.map((row) => personById.get(row.memberId)).filter((row): row is TimesheetPerson => Boolean(row)).sort((a, b) => a.name.localeCompare(b.name)),
    tasks: taskOptions
      .map((row) => (row.taskId ? { id: row.taskId, title: taskById.get(row.taskId) ?? "Task" } : null))
      .filter((row): row is { id: string; title: string } => Boolean(row))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}
