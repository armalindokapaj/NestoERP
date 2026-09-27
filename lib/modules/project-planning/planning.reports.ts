import type { Prisma } from "@prisma/client";

import { AccessError, assertModule } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays, dateOf, displayDateOf, isClosed, isDelayed, localDate, overdueDaysOf, targetDateOf, varianceDaysOf } from "./planning.dates";
import { MODULE, planningOpen, planningProjectDoor, readableMilestoneWhere } from "./planning.permissions";
import type { ReportQuery } from "./planning.schema";
import { getPlanningOverview, names } from "./planning.service";
import { resolvePlanningSettings } from "./planning.settings";
import { MILESTONE_STATUSES, STATUS_LABELS, type MilestoneStatus, type Option, type PlanningPerson } from "./planning.types";

/**
 * Planning reporting (PRD #44 §168-§175, §254-§256, §294): milestones by
 * status, project and phase; overdue milestones; forecast variance; critical
 * milestones; and a light portfolio of each project's next milestone and
 * critical delays — over the plans this reader can open. It reports the plan;
 * it is not a portfolio management suite.
 */

const ROW_LIMIT = 10_000;

const SELECT = {
  id: true,
  projectId: true,
  phaseId: true,
  name: true,
  status: true,
  ownerMemberId: true,
  baselineDate: true,
  plannedDate: true,
  forecastDate: true,
  actualDate: true,
  critical: true,
  project: { select: { name: true, code: true } },
  phase: { select: { name: true } },
} satisfies Prisma.ProjectMilestoneSelect;

export type ReportRow = {
  id: string;
  projectId: string;
  projectName: string;
  phaseName: string | null;
  name: string;
  status: MilestoneStatus;
  owner: PlanningPerson | null;
  baselineDate: string | null;
  forecastDate: string | null;
  actualDate: string | null;
  displayDate: string | null;
  varianceDays: number | null;
  overdueDays: number;
  delayed: boolean;
  critical: boolean;
  href: string;
};

export type PlanningReport = {
  query: ReportQuery;
  today: string;
  projects: Option[];
  phases: Option[];
  owners: Option[];
  totals: { total: number; completed: number; delayed: number; atRisk: number; critical: number; upcoming: number; averageVariance: number | null; delayedThisMonth: number };
  byStatus: Array<{ status: MilestoneStatus; label: string; count: number }>;
  byProject: Array<{ projectId: string; name: string; total: number; completed: number; delayed: number; atRisk: number; critical: number }>;
  byPhase: Array<{ name: string; total: number; completed: number; delayed: number }>;
  overdue: ReportRow[];
  variance: ReportRow[];
  critical: ReportRow[];
  portfolio: Array<{ projectId: string; name: string; next: ReportRow | null; criticalDelays: number; forecastEnd: string | null }>;
  /** More than ROW_LIMIT milestones matched: every figure above covers the first ROW_LIMIT only (AUD-08 §4). */
  truncated: boolean;
  /** How many rows each capped list had before its top-N cut, so a shortened list is labelled (AUD-08 §4). */
  listTotals: { overdue: number; variance: number; critical: number };
  /** More than PROJECT_OPTIONS readable projects: the project picker lists the first ones by name (plus the selected one). */
  projectsTruncated: boolean;
};

const PROJECT_OPTIONS = 500;

/** Ties within a sort fall back to the milestone id, so every ordered list and every cut is total (AUD-08 §4, DT-04). */
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The readable milestones matching `where`, in project and plan order with the
 * id as the tie-breaker. ROW_LIMIT bounds the read; one row more is asked for
 * so a read that reached it is known (`truncated`) rather than reported as
 * the whole portfolio (AUD-08 §4, DT-05).
 */
async function readRowsBounded(context: UserContext, where: Prisma.ProjectMilestoneWhereInput, today: string): Promise<{ rows: ReportRow[]; truncated: boolean }> {
  const read = await prisma.projectMilestone.findMany({ where: { AND: [readableMilestoneWhere(context), { archivedAt: null, project: { is: { archivedAt: null } } }, where] }, take: ROW_LIMIT + 1, orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }, { id: "asc" }], select: SELECT });
  const truncated = read.length > ROW_LIMIT;
  const rows = truncated ? read.slice(0, ROW_LIMIT) : read;
  const people = await names(context.companyId, rows.map((row) => row.ownerMemberId));
  return { truncated, rows: rows.map((row) => {
    const dates = { status: row.status, baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate), actualDate: dateOf(row.actualDate) };
    return {
      id: row.id,
      projectId: row.projectId,
      projectName: row.project.name,
      phaseName: row.phase?.name ?? null,
      name: row.name,
      status: row.status,
      owner: row.ownerMemberId ? (people.get(row.ownerMemberId) ?? null) : null,
      baselineDate: dates.baselineDate,
      forecastDate: targetDateOf(dates),
      actualDate: dates.actualDate,
      displayDate: displayDateOf(dates),
      varianceDays: varianceDaysOf(dates),
      overdueDays: overdueDaysOf(dates, today),
      delayed: isDelayed(dates, today),
      critical: row.critical,
      href: `/projects/${row.projectId}/planning?milestone=${row.id}`,
    };
  }) };
}

async function readRows(context: UserContext, where: Prisma.ProjectMilestoneWhereInput, today: string): Promise<ReportRow[]> {
  return (await readRowsBounded(context, where, today)).rows;
}

export async function planningReport(context: UserContext, query: ReportQuery): Promise<PlanningReport> {
  assertModule(context, MODULE);
  const door = planningProjectDoor(context);
  if (!door) throw new AccessError("FORBIDDEN", "You cannot open project plans.");
  const settings = await resolvePlanningSettings(context.companyId);
  const today = localDate(new Date(), settings.timezone);

  const where: Prisma.ProjectMilestoneWhereInput = {
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.phaseId ? { phaseId: query.phaseId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.ownerId ? { ownerMemberId: query.ownerId } : {}),
    ...(query.critical !== undefined ? { critical: query.critical } : {}),
  };
  const [projectRead, phases, read] = await Promise.all([
    prisma.project.findMany({ where: { AND: [door, { archivedAt: null }] }, orderBy: [{ name: "asc" }, { id: "asc" }], take: PROJECT_OPTIONS + 1, select: { id: true, name: true, code: true } }),
    query.projectId ? prisma.projectPhase.findMany({ where: { companyId: context.companyId, projectId: query.projectId, archivedAt: null, project: { is: door } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    readRowsBounded(context, where, today),
  ]);
  const all = read.rows;
  const projectsTruncated = projectRead.length > PROJECT_OPTIONS;
  const projects = projectRead.slice(0, PROJECT_OPTIONS);
  // The chosen project stays in the picker even past the cut, so the form shows the query the report answers (AUD-08 §3).
  if (query.projectId && !projects.some((project) => project.id === query.projectId)) {
    const chosen = await prisma.project.findFirst({ where: { AND: [door, { archivedAt: null }, { id: query.projectId }] }, select: { id: true, name: true, code: true } });
    if (chosen) projects.push(chosen);
  }
  const rows = all.filter((row) => (!query.from || (row.displayDate !== null && row.displayDate >= query.from)) && (!query.to || (row.displayDate !== null && row.displayDate <= query.to)));

  const counted = rows.filter((row) => row.status !== "CANCELLED");
  const open = counted.filter((row) => !isClosed(row.status));
  const late = (row: ReportRow) => !isClosed(row.status) && (row.delayed || row.status === "DELAYED");
  const withVariance = counted.filter((row) => row.varianceDays !== null);
  const monthStart = `${today.slice(0, 7)}-01`;
  const horizon = addLocalDays(today, 30);

  const byProject = new Map<string, PlanningReport["byProject"][number]>();
  for (const row of counted) {
    const entry = byProject.get(row.projectId) ?? { projectId: row.projectId, name: row.projectName, total: 0, completed: 0, delayed: 0, atRisk: 0, critical: 0 };
    entry.total += 1;
    if (row.status === "COMPLETED") entry.completed += 1;
    if (late(row)) entry.delayed += 1;
    if (row.status === "AT_RISK") entry.atRisk += 1;
    if (row.critical) entry.critical += 1;
    byProject.set(row.projectId, entry);
  }
  const byPhase = new Map<string, PlanningReport["byPhase"][number]>();
  if (query.projectId) {
    for (const row of counted) {
      const key = row.phaseName ?? "No phase";
      const entry = byPhase.get(key) ?? { name: key, total: 0, completed: 0, delayed: 0 };
      entry.total += 1;
      if (row.status === "COMPLETED") entry.completed += 1;
      if (late(row)) entry.delayed += 1;
      byPhase.set(key, entry);
    }
  }

  const portfolio = [...new Set(counted.map((row) => row.projectId))].map((projectId) => {
    const own = counted.filter((row) => row.projectId === projectId);
    const next = own.filter((row) => !isClosed(row.status) && row.displayDate).sort((a, b) => a.displayDate!.localeCompare(b.displayDate!) || byId(a, b))[0] ?? null;
    const ends = own.map((row) => row.displayDate).filter((date): date is string => Boolean(date)).sort();
    return { projectId, name: own[0].projectName, next, criticalDelays: own.filter((row) => row.critical && late(row)).length, forecastEnd: ends[ends.length - 1] ?? null };
  });

  const ownerIds = [...new Set(all.map((row) => row.owner?.memberId).filter((id): id is string => Boolean(id)))];
  const overdue = open.filter((row) => row.delayed);
  const critical = counted.filter((row) => row.critical);
  return {
    query,
    today,
    projects: projects.map((project) => ({ id: project.id, label: `${project.code} · ${project.name}` })),
    phases: phases.map((phase) => ({ id: phase.id, label: phase.name })),
    owners: ownerIds.map((id) => ({ id, label: all.find((row) => row.owner?.memberId === id)!.owner!.name })).sort((a, b) => a.label.localeCompare(b.label)),
    totals: {
      total: counted.length,
      completed: counted.filter((row) => row.status === "COMPLETED").length,
      delayed: counted.filter(late).length,
      atRisk: counted.filter((row) => row.status === "AT_RISK").length,
      critical: counted.filter((row) => row.critical).length,
      upcoming: open.filter((row) => row.displayDate && row.displayDate >= today && row.displayDate <= horizon).length,
      averageVariance: withVariance.length ? Math.round((withVariance.reduce((sum, row) => sum + row.varianceDays!, 0) / withVariance.length) * 10) / 10 : null,
      delayedThisMonth: counted.filter((row) => late(row) && row.forecastDate && row.forecastDate >= monthStart && row.forecastDate < today).length,
    },
    byStatus: MILESTONE_STATUSES.map((status) => ({ status, label: STATUS_LABELS[status], count: rows.filter((row) => row.status === status).length })),
    byProject: [...byProject.values()].sort((a, b) => b.delayed - a.delayed || a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId)),
    byPhase: [...byPhase.values()],
    overdue: overdue.sort((a, b) => b.overdueDays - a.overdueDays || byId(a, b)).slice(0, 50),
    variance: withVariance.sort((a, b) => (b.varianceDays ?? 0) - (a.varianceDays ?? 0) || byId(a, b)).slice(0, 100),
    // Late first, then what is still ahead by date; achieved ones last (§168).
    critical: critical.sort((a, b) => Number(late(b)) - Number(late(a)) || Number(isClosed(a.status)) - Number(isClosed(b.status)) || (a.displayDate ?? "9999").localeCompare(b.displayDate ?? "9999") || byId(a, b)).slice(0, 100),
    portfolio: portfolio.sort((a, b) => b.criticalDelays - a.criticalDelays || a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId)),
    truncated: read.truncated,
    listTotals: { overdue: overdue.length, variance: withVariance.length, critical: critical.length },
    projectsTruncated,
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard and project overview                                              */
/* -------------------------------------------------------------------------- */

const OPEN = { archivedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] as MilestoneStatus[] }, project: { is: { archivedAt: null, status: "ACTIVE" as const } } };

/** Delayed first, then the next thirty days, on the projects this reader can open (§169). */
export async function upcomingMilestones(context: UserContext, limit = 6): Promise<ReportRow[]> {
  if (!planningOpen(context)) return [];
  const settings = await resolvePlanningSettings(context.companyId);
  const today = localDate(new Date(), settings.timezone);
  const horizon = new Date(`${addLocalDays(today, 30)}T23:59:59.000Z`);
  const rows = await readRows(context, { ...OPEN, OR: [{ forecastDate: { lte: horizon } }, { forecastDate: null, plannedDate: { lte: horizon } }, { forecastDate: null, plannedDate: null, baselineDate: { lte: horizon } }] }, today);
  return rows.sort((a, b) => Number(b.delayed) - Number(a.delayed) || (a.displayDate ?? "").localeCompare(b.displayDate ?? "") || byId(a, b)).slice(0, limit);
}

/** Critical milestones that are late, at risk or critically blocked, across projects (§168, §170). */
export async function criticalMilestones(context: UserContext, limit = 6): Promise<Array<ReportRow & { blocked: boolean }>> {
  if (!planningOpen(context)) return [];
  const settings = await resolvePlanningSettings(context.companyId);
  const today = localDate(new Date(), settings.timezone);
  const rows = await readRows(context, { ...OPEN, critical: true }, today);
  const blocked = new Set((await prisma.projectMilestoneBlocker.findMany({ where: { milestoneId: { in: rows.map((row) => row.id) }, severity: "CRITICAL", resolvedAt: null }, select: { milestoneId: true } })).map((row) => row.milestoneId));
  return rows
    .map((row) => ({ ...row, blocked: blocked.has(row.id) }))
    .filter((row) => row.delayed || row.status === "AT_RISK" || row.status === "DELAYED" || row.blocked)
    .sort((a, b) => b.overdueDays - a.overdueDays || (a.displayDate ?? "").localeCompare(b.displayDate ?? "") || byId(a, b))
    .slice(0, limit);
}

/** The planning card on a project's overview: next milestone, delays, risk and progress by phase (§169). */
export async function projectPlanningSummary(context: UserContext, projectId: string) {
  if (!planningOpen(context)) return null;
  const overview = await getPlanningOverview(context, projectId).catch(() => null);
  if (!overview) return null;
  const next = overview.milestones.filter((milestone) => !isClosed(milestone.status) && milestone.displayDate).sort((a, b) => a.displayDate!.localeCompare(b.displayDate!))[0] ?? null;
  return {
    metrics: overview.metrics,
    next: next ? { id: next.id, name: next.name, date: next.displayDate, delayed: next.delayed, status: next.status } : null,
    phases: overview.phases.map((phase) => ({ id: phase.id, name: phase.name, status: phase.status, progress: phase.progressPercent ?? phase.suggestedProgress })),
  };
}
