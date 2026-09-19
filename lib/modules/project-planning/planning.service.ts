import { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, type SecurityReasonCode } from "@/lib/access/guards";
import { buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { moduleAndPermissions, recordDefinition } from "@/lib/core/records/record.registry";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import { listDocuments } from "@/lib/modules/documents/document.service";
import { isFavorite } from "@/lib/modules/productivity/favorites.service";
import {
  addLocalDays,
  dateLabel,
  dateOf,
  displayDateOf,
  earliestAfter,
  isClosed,
  isDelayed,
  localDate,
  overdueDaysOf,
  targetDateOf,
  varianceDaysOf,
  type DatedMilestone,
} from "./planning.dates";
import {
  ACTIVITY_ENTITY,
  MODULE,
  milestoneCapabilities,
  planningCapabilities,
  planningOpen,
  planningProjectDoor,
  readableMilestoneWhere,
  RECORD,
  RECORD_LINK_TYPE,
} from "./planning.permissions";
import type { MilestoneListQuery } from "./planning.schema";
import { resolvePlanningSettings } from "./planning.settings";
import type {
  BlockerDTO,
  DependencyEdgeDTO,
  LinkedRecordDTO,
  MilestoneDetailDTO,
  MilestoneRelationDTO,
  MilestoneSummaryDTO,
  Option,
  PhaseSummaryDTO,
  PlanningHistoryEntry,
  PlanningMetrics,
  PlanningPerson,
  ProjectPlanningOverviewDTO,
  TimelineDTO,
} from "./planning.types";

/**
 * Project planning: reading a plan (PRD #44 §8, §96, §128-§131, §186, §188,
 * §218-§224, §276-§279).
 *
 * A plan is read whole, one project at a time, in a bounded number of queries:
 * phases, milestones, dependencies, then batched task counts, blocker counts
 * and owner names. Nothing here trusts a project, phase or member from the
 * browser; every read goes through the project door.
 */

/** `reason` is the security reason a refusal is logged under (PRD #47 §118); the response keeps code and message. */
export function fail(code: string, message: string, status: "VALIDATION_ERROR" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" = "VALIDATION_ERROR", extra: Record<string, unknown> = {}, reason?: SecurityReasonCode): AccessError {
  return new AccessError(status, message, { code, ...extra }, reason);
}

export const PROJECT_SELECT = {
  id: true,
  companyId: true,
  name: true,
  code: true,
  status: true,
  archivedAt: true,
  startDate: true,
  endDate: true,
  planningBaselineLocked: true,
  planningTemplateKey: true,
  projectManagerMemberId: true,
} satisfies Prisma.ProjectSelect;

export type PlanningProject = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

export function projectState(project: Pick<PlanningProject, "archivedAt" | "status" | "planningBaselineLocked">) {
  return { archived: Boolean(project.archivedAt) || project.status === "ARCHIVED", baselineLocked: project.planningBaselineLocked };
}

export async function loadPlanningProject(context: UserContext, projectId: string): Promise<PlanningProject> {
  assertModule(context, MODULE);
  const door = planningProjectDoor(context);
  if (!door) throw new AccessError("FORBIDDEN", "You cannot open project plans.");
  const project = await prisma.project.findFirst({ where: { AND: [door, { id: projectId }] }, select: PROJECT_SELECT });
  if (!project) throw fail("PLANNING_PROJECT_NOT_FOUND", "That project could not be found.", "NOT_FOUND");
  return project;
}

/** An archived project's plan is history (§273). */
export function assertWritable(project: Pick<PlanningProject, "archivedAt" | "status">) {
  if (project.archivedAt || project.status === "ARCHIVED") throw fail("PLANNING_PROJECT_ARCHIVED", "This project is archived, so its plan is read-only.", "CONFLICT");
}

export const MILESTONE_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  phaseId: true,
  name: true,
  description: true,
  milestoneType: true,
  status: true,
  ownerMemberId: true,
  baselineDate: true,
  plannedDate: true,
  forecastDate: true,
  actualDate: true,
  progressPercent: true,
  critical: true,
  externallyCommitted: true,
  sortOrder: true,
  statusChangedAt: true,
  completionNote: true,
  completedByMemberId: true,
  reopenedAt: true,
  archivedAt: true,
  createdByMemberId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectMilestoneSelect;

export type MilestoneRow = Prisma.ProjectMilestoneGetPayload<{ select: typeof MILESTONE_SELECT }>;

export async function findReadableMilestone(context: UserContext, milestoneId: string) {
  assertModule(context, MODULE);
  if (!planningOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open project plans.");
  const row = await prisma.projectMilestone.findFirst({
    where: { AND: [readableMilestoneWhere(context), { id: milestoneId }] },
    select: { ...MILESTONE_SELECT, project: { select: PROJECT_SELECT } },
  });
  if (!row) throw fail("MILESTONE_NOT_FOUND", "That milestone could not be found.", "NOT_FOUND");
  return row;
}

export type ReadableMilestone = Awaited<ReturnType<typeof findReadableMilestone>>;

export const decimal = (value: Prisma.Decimal | null) => (value === null ? null : Number(value.toString()));

export function dated(row: Pick<MilestoneRow, "status" | "baselineDate" | "plannedDate" | "forecastDate" | "actualDate">): DatedMilestone {
  return { status: row.status, baselineDate: dateOf(row.baselineDate), plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate), actualDate: dateOf(row.actualDate) };
}

export async function names(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, PlanningPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, { memberId: row.id, name: `${row.user.firstName} ${row.user.lastName}`, active: row.status === "ACTIVE" }]));
}

/** The people a milestone or blocker may be given to: the project's manager and its active members. */
export async function projectMemberOptions(companyId: string, projectId: string): Promise<Option[]> {
  const rows = await prisma.companyMember.findMany({
    where: { companyId, status: "ACTIVE", OR: [{ projectMemberships: { some: { projectId, status: "ACTIVE" } } }, { managedProjects: { some: { id: projectId } } }] },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    take: 300,
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({ id: row.id, label: `${row.user.firstName} ${row.user.lastName}` }));
}

/** An owner is someone on the project, in this company, still active (§47, §48, §198). */
export async function assertAssignable(companyId: string, projectId: string, memberId: string | null) {
  if (!memberId) return;
  const found = await prisma.companyMember.count({
    where: { id: memberId, companyId, status: "ACTIVE", OR: [{ projectMemberships: { some: { projectId, status: "ACTIVE" } } }, { managedProjects: { some: { id: projectId } } }] },
  });
  if (!found) throw fail("PLANNING_MEMBER_INVALID", "That person is not on this project.", "VALIDATION_ERROR", { field: "ownerMemberId" });
}

export async function planningToday(companyId: string) {
  const settings = await resolvePlanningSettings(companyId);
  return { settings, today: localDate(new Date(), settings.timezone) };
}

/* -------------------------------------------------------------------------- */
/* Summaries                                                                   */
/* -------------------------------------------------------------------------- */

type EdgeRow = { id: string; predecessorMilestoneId: string; successorMilestoneId: string; lagDays: number };

const UPCOMING_DAYS = 30;

export async function summarize(companyId: string, rows: MilestoneRow[], edges: EdgeRow[], today: string): Promise<{ milestones: MilestoneSummaryDTO[]; dependencies: DependencyEdgeDTO[] }> {
  const ids = rows.map((row) => row.id);
  const [links, blockers, people] = await Promise.all([
    ids.length ? prisma.projectMilestoneTaskLink.findMany({ where: { milestoneId: { in: ids } }, select: { milestoneId: true, taskId: true } }) : [],
    ids.length ? prisma.projectMilestoneBlocker.groupBy({ by: ["milestoneId", "severity"], where: { milestoneId: { in: ids }, resolvedAt: null }, _count: { _all: true } }) : [],
    names(companyId, rows.map((row) => row.ownerMemberId)),
  ]);
  const tasks = links.length ? await prisma.task.findMany({ where: { companyId, id: { in: [...new Set(links.map((link) => link.taskId))] } }, select: { id: true, status: true } }) : [];
  const taskStatus = new Map(tasks.map((task) => [task.id, task.status]));
  const taskStats = new Map<string, { total: number; completed: number }>();
  for (const link of links) {
    const status = taskStatus.get(link.taskId);
    if (!status || status === "ARCHIVED") continue;
    const stats = taskStats.get(link.milestoneId) ?? { total: 0, completed: 0 };
    stats.total += 1;
    if (status === "COMPLETED") stats.completed += 1;
    taskStats.set(link.milestoneId, stats);
  }
  const openBlockers = new Map<string, { open: number; critical: number }>();
  for (const group of blockers) {
    const counts = openBlockers.get(group.milestoneId) ?? { open: 0, critical: 0 };
    counts.open += group._count._all;
    if (group.severity === "CRITICAL") counts.critical += group._count._all;
    openBlockers.set(group.milestoneId, counts);
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const live = edges.filter((edge) => byId.has(edge.predecessorMilestoneId) && byId.has(edge.successorMilestoneId));
  const datedById = new Map(rows.map((row) => [row.id, dated(row)]));

  const dependencies: DependencyEdgeDTO[] = live.map((edge) => {
    const predecessor = datedById.get(edge.predecessorMilestoneId)!;
    const successor = datedById.get(edge.successorMilestoneId)!;
    const late = overdueDaysOf(predecessor, today);
    const earliest = earliestAfter([{ ...predecessor, lagDays: edge.lagDays }]);
    const successorTarget = targetDateOf(successor);
    let warning: string | null = null;
    if (late > 0) warning = `Predecessor delayed ${late} ${late === 1 ? "day" : "days"}`;
    else if (!isClosed(successor.status) && earliest && successorTarget && successorTarget < earliest) warning = `Successor is forecast before ${dateLabel(earliest)}`;
    return { id: edge.id, predecessorId: edge.predecessorMilestoneId, successorId: edge.successorMilestoneId, lagDays: edge.lagDays, satisfied: predecessor.status === "COMPLETED", warning };
  });

  const incoming = new Map<string, EdgeRow[]>();
  for (const edge of live) incoming.set(edge.successorMilestoneId, [...(incoming.get(edge.successorMilestoneId) ?? []), edge]);

  const milestones = rows.map((row): MilestoneSummaryDTO => {
    const date = datedById.get(row.id)!;
    const predecessors = (incoming.get(row.id) ?? []).map((edge) => ({ edge, predecessor: datedById.get(edge.predecessorMilestoneId)!, name: byId.get(edge.predecessorMilestoneId)!.name }));
    const waitingOn = predecessors.filter(({ predecessor }) => !isClosed(predecessor.status)).length;
    let dependencyWarning: string | null = null;
    if (!isClosed(row.status)) {
      const late = predecessors.map(({ predecessor }) => overdueDaysOf(predecessor, today)).reduce((max, days) => Math.max(max, days), 0);
      const earliest = earliestAfter(predecessors.map(({ edge, predecessor }) => ({ ...predecessor, lagDays: edge.lagDays })));
      const target = targetDateOf(date);
      if (late > 0) dependencyWarning = `Predecessor delayed ${late} ${late === 1 ? "day" : "days"}`;
      else if (earliest && target && target < earliest) dependencyWarning = `Forecast is before its predecessors allow (${dateLabel(earliest)})`;
    }
    const blockerCounts = openBlockers.get(row.id) ?? { open: 0, critical: 0 };
    return {
      id: row.id,
      name: row.name,
      description: row.description ? row.description.slice(0, 280) : null,
      phaseId: row.phaseId,
      type: row.milestoneType,
      owner: row.ownerMemberId ? (people.get(row.ownerMemberId) ?? null) : null,
      ...date,
      displayDate: displayDateOf(date),
      varianceDays: varianceDaysOf(date),
      delayed: isDelayed(date, today),
      overdueDays: overdueDaysOf(date, today),
      critical: row.critical,
      externallyCommitted: row.externallyCommitted,
      progressPercent: decimal(row.progressPercent),
      taskStats: taskStats.get(row.id) ?? { total: 0, completed: 0 },
      openBlockerCount: blockerCounts.open,
      criticalBlockerCount: blockerCounts.critical,
      waitingOn,
      dependencyWarning,
      sortOrder: row.sortOrder,
      version: row.version,
    };
  });
  return { milestones, dependencies };
}

export function metricsOf(milestones: MilestoneSummaryDTO[], today: string): PlanningMetrics {
  const counted = milestones.filter((milestone) => milestone.status !== "CANCELLED");
  const horizon = addLocalDays(today, UPCOMING_DAYS);
  const completed = counted.filter((milestone) => milestone.status === "COMPLETED").length;
  return {
    total: counted.length,
    completed,
    upcoming: counted.filter((milestone) => !isClosed(milestone.status) && milestone.displayDate && milestone.displayDate >= today && milestone.displayDate <= horizon).length,
    atRisk: counted.filter((milestone) => milestone.status === "AT_RISK").length,
    delayed: counted.filter((milestone) => !isClosed(milestone.status) && (milestone.delayed || milestone.status === "DELAYED")).length,
    critical: counted.filter((milestone) => milestone.critical).length,
    progressPercent: counted.length ? Math.round((completed / counted.length) * 100) : null,
  };
}

/** Upcoming, delayed, at risk, critical or completed — the quick filters (§125), shared by list and UI. */
export function matchesQuick(milestone: MilestoneSummaryDTO, quick: NonNullable<MilestoneListQuery["quick"]>, today: string): boolean {
  switch (quick) {
    case "upcoming":
      return !isClosed(milestone.status) && Boolean(milestone.displayDate) && milestone.displayDate! >= today && milestone.displayDate! <= addLocalDays(today, UPCOMING_DAYS);
    case "delayed":
      return !isClosed(milestone.status) && (milestone.delayed || milestone.status === "DELAYED");
    case "at_risk":
      return milestone.status === "AT_RISK";
    case "critical":
      return milestone.critical && milestone.status !== "CANCELLED";
    case "completed":
      return milestone.status === "COMPLETED";
  }
}

/* -------------------------------------------------------------------------- */
/* Overview, timeline, list                                                    */
/* -------------------------------------------------------------------------- */

async function readPlan(project: PlanningProject, today: string) {
  const [phases, rows, edges] = await Promise.all([
    prisma.projectPhase.findMany({ where: { companyId: project.companyId, projectId: project.id, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.projectMilestone.findMany({ where: { companyId: project.companyId, projectId: project.id, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: MILESTONE_SELECT }),
    prisma.projectMilestoneDependency.findMany({ where: { companyId: project.companyId, projectId: project.id }, select: { id: true, predecessorMilestoneId: true, successorMilestoneId: true, lagDays: true } }),
  ]);
  const phaseOrder = new Map(phases.map((phase, index) => [phase.id, index]));
  rows.sort((a, b) => (phaseOrder.get(a.phaseId ?? "") ?? 9_999) - (phaseOrder.get(b.phaseId ?? "") ?? 9_999) || a.sortOrder - b.sortOrder);
  const summary = await summarize(project.companyId, rows, edges, today);
  return { phases, ...summary };
}

async function phaseSummaries(companyId: string, phases: Awaited<ReturnType<typeof readPlan>>["phases"], milestones: MilestoneSummaryDTO[]): Promise<PhaseSummaryDTO[]> {
  const people = await names(companyId, phases.map((phase) => phase.ownerMemberId));
  return phases.map((phase) => {
    const own = milestones.filter((milestone) => milestone.phaseId === phase.id);
    const counted = own.filter((milestone) => milestone.status !== "CANCELLED");
    const completed = counted.filter((milestone) => milestone.status === "COMPLETED").length;
    const dates = own.map((milestone) => milestone.displayDate).filter((date): date is string => Boolean(date)).sort();
    const start = dateOf(phase.actualStartDate) ?? dateOf(phase.forecastStartDate) ?? dateOf(phase.plannedStartDate) ?? dates[0] ?? null;
    const end = dateOf(phase.actualEndDate) ?? dateOf(phase.forecastEndDate) ?? dateOf(phase.plannedEndDate) ?? dates[dates.length - 1] ?? null;
    return {
      id: phase.id,
      name: phase.name,
      description: phase.description,
      sortOrder: phase.sortOrder,
      status: phase.status,
      progressPercent: decimal(phase.progressPercent),
      suggestedProgress: counted.length ? Math.round((completed / counted.length) * 100) : null,
      plannedStartDate: dateOf(phase.plannedStartDate),
      plannedEndDate: dateOf(phase.plannedEndDate),
      forecastStartDate: dateOf(phase.forecastStartDate),
      forecastEndDate: dateOf(phase.forecastEndDate),
      actualStartDate: dateOf(phase.actualStartDate),
      actualEndDate: dateOf(phase.actualEndDate),
      owner: phase.ownerMemberId ? (people.get(phase.ownerMemberId) ?? null) : null,
      milestoneCount: counted.length,
      completedCount: completed,
      span: start && end ? (start <= end ? { start, end } : { start: end, end: start }) : start ? { start, end: start } : end ? { start: end, end } : null,
      version: phase.version,
    };
  });
}

export async function getPlanningOverview(context: UserContext, projectId: string): Promise<ProjectPlanningOverviewDTO> {
  const started = Date.now();
  const project = await loadPlanningProject(context, projectId);
  const { settings, today } = await planningToday(context.companyId);
  const plan = await readPlan(project, today);
  const state = projectState(project);
  const capabilities = planningCapabilities(context, state);
  const editor = capabilities.canEditMilestone || capabilities.canCreateMilestone || capabilities.canEditPhase || capabilities.canManageBlockers;
  const [phases, members] = await Promise.all([phaseSummaries(context.companyId, plan.phases, plan.milestones), editor ? projectMemberOptions(context.companyId, project.id) : Promise.resolve([])]);
  const overview: ProjectPlanningOverviewDTO = {
    projectId: project.id,
    project: { id: project.id, name: project.name, code: project.code, status: project.status, startDate: dateOf(project.startDate), endDate: dateOf(project.endDate), archived: state.archived },
    today,
    timezone: settings.timezone,
    phases,
    milestones: plan.milestones,
    dependencies: plan.dependencies,
    metrics: metricsOf(plan.milestones, today),
    capabilities,
    baselineLocked: project.planningBaselineLocked,
    baselineReasonRequired: settings.baselineChangeReasonRequired,
    templateKey: project.planningTemplateKey,
    members,
  };
  incrementCounter(Metric.PLANNING_OVERVIEW_DURATION_MS, {}, Date.now() - started);
  return overview;
}

/** Phase ranges, milestone points and dependency edges — nothing else (§278). */
export async function getPlanningTimeline(context: UserContext, projectId: string): Promise<TimelineDTO> {
  const started = Date.now();
  const project = await loadPlanningProject(context, projectId);
  const { today } = await planningToday(context.companyId);
  const plan = await readPlan(project, today);
  const phases = await phaseSummaries(context.companyId, plan.phases, plan.milestones);
  const timeline: TimelineDTO = {
    projectId: project.id,
    today,
    phases: phases.map((phase) => ({ id: phase.id, name: phase.name, status: phase.status, progressPercent: phase.progressPercent, start: phase.span?.start ?? null, end: phase.span?.end ?? null })),
    milestones: plan.milestones.map((milestone) => ({ id: milestone.id, phaseId: milestone.phaseId, name: milestone.name, date: milestone.displayDate, baselineDate: milestone.baselineDate, status: milestone.status, critical: milestone.critical, delayed: milestone.delayed, varianceDays: milestone.varianceDays })),
    edges: plan.dependencies.map((edge) => ({ id: edge.id, from: edge.predecessorId, to: edge.successorId, lagDays: edge.lagDays })),
  };
  incrementCounter(Metric.PLANNING_TIMELINE_DURATION_MS, {}, Date.now() - started);
  return timeline;
}

export async function listMilestones(context: UserContext, projectId: string, query: MilestoneListQuery): Promise<MilestoneSummaryDTO[]> {
  const project = await loadPlanningProject(context, projectId);
  const { today } = await planningToday(context.companyId);
  const { milestones } = await readPlan(project, today);
  const term = query.q?.toLowerCase();
  return milestones.filter(
    (milestone) =>
      (!query.phaseId || milestone.phaseId === query.phaseId) &&
      (!query.status || milestone.status === query.status) &&
      (!query.ownerId || milestone.owner?.memberId === query.ownerId) &&
      (query.critical === undefined || milestone.critical === query.critical) &&
      (!query.from || (milestone.displayDate !== null && milestone.displayDate >= query.from)) &&
      (!query.to || (milestone.displayDate !== null && milestone.displayDate <= query.to)) &&
      (!term || milestone.name.toLowerCase().includes(term) || (milestone.description ?? "").toLowerCase().includes(term)) &&
      (!query.quick || matchesQuick(milestone, query.quick, today)),
  );
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

const HISTORY: Record<string, string> = {
  MILESTONE_CREATED: "Milestone created",
  MILESTONE_COMPLETED: "Milestone completed",
  MILESTONE_REOPENED: "Milestone reopened",
  MILESTONE_DELAYED: "Milestone delayed",
  MILESTONE_AT_RISK: "Milestone at risk",
  MILESTONE_BASELINE_CHANGED: "Baseline changed",
  MILESTONE_FORECAST_CHANGED: "Forecast changed",
  MILESTONE_OWNER_CHANGED: "Owner changed",
  MILESTONE_CRITICAL_BLOCKER: "Critical blocker added",
  MILESTONE_BLOCKER_RESOLVED: "Blocker resolved",
  MILESTONE_ARCHIVED: "Milestone archived",
  MILESTONE_CANCELLED: "Milestone cancelled",
};

async function linkedRecords(context: UserContext, milestoneId: string): Promise<LinkedRecordDTO[]> {
  const links = await prisma.integrationLink.findMany({
    where: { companyId: context.companyId, integrationType: RECORD_LINK_TYPE, sourceEntityType: RECORD, sourceEntityId: milestoneId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, targetEntityType: true, targetEntityId: true },
  });
  const summaries = new Map<string, { label: string; href: string }>();
  const byType = new Map<string, string[]>();
  for (const link of links) byType.set(link.targetEntityType, [...(byType.get(link.targetEntityType) ?? []), link.targetEntityId]);
  for (const [type, ids] of byType) {
    const definition = recordDefinition(type);
    // Each linked record keeps its own door: its module, its grants, its scope (§183, §184).
    if (!definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) continue;
    const reachable = new Set(await definition.reachable(context, ids));
    for (const id of ids) {
      if (!reachable.has(id)) continue;
      const summary = await definition.find(context, id);
      if (summary) summaries.set(`${type}:${id}`, { label: summary.label, href: summary.href });
    }
  }
  return links.map((link) => {
    const summary = summaries.get(`${link.targetEntityType}:${link.targetEntityId}`);
    const recordType = link.targetEntityType === "daily_log" ? "daily_log" : "meeting";
    return {
      linkId: link.id,
      recordType,
      recordId: link.targetEntityId,
      label: summary?.label ?? (recordType === "meeting" ? "A meeting you cannot open" : "A daily log you cannot open"),
      href: summary?.href ?? null,
      restricted: !summary,
    };
  });
}

export async function getMilestone(context: UserContext, milestoneId: string): Promise<MilestoneDetailDTO> {
  const row = await findReadableMilestone(context, milestoneId);
  const project = row.project;
  const { settings, today } = await planningToday(context.companyId);
  const [edges, phase, linkRows, blockerRows, records, activities] = await Promise.all([
    prisma.projectMilestoneDependency.findMany({ where: { OR: [{ successorMilestoneId: row.id }, { predecessorMilestoneId: row.id }] }, select: { id: true, predecessorMilestoneId: true, successorMilestoneId: true, lagDays: true } }),
    row.phaseId ? prisma.projectPhase.findFirst({ where: { id: row.phaseId, companyId: context.companyId }, select: { id: true, name: true } }) : Promise.resolve(null),
    prisma.projectMilestoneTaskLink.findMany({ where: { milestoneId: row.id }, orderBy: { createdAt: "asc" }, select: { taskId: true, linkType: true } }),
    prisma.projectMilestoneBlocker.findMany({ where: { milestoneId: row.id }, orderBy: [{ resolvedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }] }),
    linkedRecords(context, row.id),
    prisma.activity.findMany({ where: { companyId: context.companyId, entityType: ACTIVITY_ENTITY, entityId: row.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, actorMemberId: true, createdAt: true, metadata: true } }),
  ]);

  const relatedIds = [...new Set(edges.flatMap((edge) => [edge.predecessorMilestoneId, edge.successorMilestoneId]).filter((id) => id !== row.id))];
  const related = relatedIds.length ? await prisma.projectMilestone.findMany({ where: { id: { in: relatedIds }, companyId: context.companyId, projectId: project.id, archivedAt: null }, select: MILESTONE_SELECT }) : [];
  const relatedById = new Map(related.map((milestone) => [milestone.id, milestone]));
  const { milestones: [summary] } = await summarize(context.companyId, [row, ...related], edges, today);

  const relation = (edge: (typeof edges)[number], otherId: string): MilestoneRelationDTO | null => {
    const other = relatedById.get(otherId);
    if (!other) return null;
    const date = dated(other);
    return { dependencyId: edge.id, milestoneId: other.id, name: other.name, status: other.status, targetDate: displayDateOf(date), lagDays: edge.lagDays, delayed: isDelayed(date, today), overdueDays: overdueDaysOf(date, today) };
  };
  const predecessorEdges = edges.filter((edge) => edge.successorMilestoneId === row.id);
  const predecessors = predecessorEdges.map((edge) => relation(edge, edge.predecessorMilestoneId)).filter((value): value is MilestoneRelationDTO => Boolean(value));
  const successors = edges.filter((edge) => edge.predecessorMilestoneId === row.id).map((edge) => relation(edge, edge.successorMilestoneId)).filter((value): value is MilestoneRelationDTO => Boolean(value));

  // Tasks: counted for everybody, named only for readers who can open them (§185).
  const taskIds = [...new Set([...linkRows.map((link) => link.taskId), ...blockerRows.map((blocker) => blocker.linkedTaskId).filter((id): id is string => Boolean(id))])];
  const tasksOpen = canAccessModule(context, "tasks") && can(context, "task.view");
  const [allTasks, visibleTasks] = await Promise.all([
    taskIds.length ? prisma.task.findMany({ where: { companyId: context.companyId, id: { in: taskIds } }, select: { id: true, title: true, status: true } }) : [],
    taskIds.length && tasksOpen ? prisma.task.findMany({ where: { AND: [buildTaskScopeWhere(context), { id: { in: taskIds } }] }, select: { id: true } }) : [],
  ]);
  const taskInfo = new Map(allTasks.map((task) => [task.id, task]));
  const visible = new Set(visibleTasks.map((task) => task.id));

  const people = await names(context.companyId, [row.ownerMemberId, row.completedByMemberId, row.createdByMemberId, ...blockerRows.flatMap((blocker) => [blocker.ownerMemberId, blocker.resolvedByMemberId]), ...activities.map((entry) => entry.actorMemberId)]);
  const person = (id: string | null) => (id ? (people.get(id) ?? null) : null);

  const blockers: BlockerDTO[] = blockerRows.map((blocker) => {
    const task = blocker.linkedTaskId ? taskInfo.get(blocker.linkedTaskId) : null;
    const dueDate = dateOf(blocker.dueDate);
    return {
      id: blocker.id,
      title: blocker.title,
      description: blocker.description,
      severity: blocker.severity,
      owner: person(blocker.ownerMemberId),
      dueDate,
      overdue: Boolean(!blocker.resolvedAt && dueDate && dueDate < today),
      resolvedAt: blocker.resolvedAt?.toISOString() ?? null,
      resolvedBy: person(blocker.resolvedByMemberId),
      resolutionNote: blocker.resolutionNote,
      linkedTask: task ? (visible.has(task.id) ? { id: task.id, title: task.title, href: `/tasks/${task.id}` } : { id: task.id, title: "A task you cannot open", href: null }) : null,
      createdAt: blocker.createdAt.toISOString(),
      updatedAt: blocker.updatedAt.toISOString(),
    };
  });

  const capabilities = milestoneCapabilities(context, projectState(project), row.status, Boolean(row.archivedAt));
  let documents: MilestoneDetailDTO["documents"] = null;
  if (capabilities.canViewDocuments) {
    const { data } = await listDocuments(context, documentListQuerySchema.parse({ entityType: RECORD, entityId: row.id, limit: 100 })).catch(() => ({ data: [] }));
    documents = data.map((document) => ({ documentId: document.id, name: document.name, fileName: document.originalFileName, extension: document.extension, uploadedAt: document.createdAt, uploadedBy: document.uploadedBy?.fullName ?? null, uploadedByMemberId: document.uploadedBy?.memberId ?? null, href: `/documents/${document.id}` }));
  }

  const history: PlanningHistoryEntry[] = activities
    .filter((entry) => HISTORY[entry.action])
    .map((entry) => ({ id: entry.id, action: HISTORY[entry.action], actorName: person(entry.actorMemberId)?.name ?? null, actorMemberId: person(entry.actorMemberId)?.memberId ?? null, occurredAt: entry.createdAt.toISOString(), note: (entry.metadata as { note?: string } | null)?.note ?? null }));

  const date = dated(row);
  const earliest = earliestAfter(predecessorEdges.map((edge) => relatedById.get(edge.predecessorMilestoneId)).map((other, index) => (other ? { ...dated(other), lagDays: predecessorEdges[index].lagDays } : null)).filter((value): value is DatedMilestone & { lagDays: number } => Boolean(value)));
  const target = targetDateOf(date);
  const atRisk: string[] = [];
  if (!isClosed(row.status)) {
    if (summary.varianceDays !== null && summary.varianceDays > 0) atRisk.push(`Forecast is ${summary.varianceDays} ${summary.varianceDays === 1 ? "day" : "days"} after the baseline`);
    if (blockers.some((blocker) => blocker.severity === "CRITICAL" && !blocker.resolvedAt)) atRisk.push("An open critical blocker");
    if (predecessors.some((predecessor) => predecessor.delayed)) atRisk.push("A predecessor is late");
  }

  return {
    ...summary,
    description: row.description,
    project: { id: project.id, name: project.name, code: project.code },
    phase,
    today,
    completionNote: row.completionNote,
    completedBy: person(row.completedByMemberId),
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    createdBy: person(row.createdByMemberId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    baselineLocked: project.planningBaselineLocked,
    baselineReasonRequired: settings.baselineChangeReasonRequired,
    predecessors,
    successors,
    tasks: linkRows.map((link) => {
      const task = taskInfo.get(link.taskId);
      const open = visible.has(link.taskId) && task;
      return { taskId: link.taskId, title: open ? task.title : "A task you cannot open", status: open ? task.status : null, linkType: link.linkType, href: open ? `/tasks/${link.taskId}` : null, visible: Boolean(open) };
    }),
    blockers,
    meetings: records.filter((record) => record.recordType === "meeting"),
    dailyLogs: records.filter((record) => record.recordType === "daily_log"),
    documents,
    history,
    suggestion: { forecastDate: !isClosed(row.status) && earliest && (!target || target < earliest) ? earliest : null, atRisk },
    capabilities,
    favorite: await isFavorite(context, RECORD, row.id),
  };
}
