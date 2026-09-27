import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import type { Prisma } from "@prisma/client";
import { SNAPSHOT } from "../hse.list";
import { RISK_AXIS, calculateRiskLevel, riskLevelLabels } from "../hse.risk";
import {
  buildActionScopeWhere,
  buildHazardScopeWhere,
  buildIncidentScopeWhere,
  buildInspectionScopeWhere,
  buildObservationScopeWhere,
  buildPermitScopeWhere,
  buildPpeScopeWhere,
  buildRiskAssessmentScopeWhere,
  buildStopWorkScopeWhere,
  buildToolboxScopeWhere,
} from "../hse.scope";
import {
  environmentalCategoryLabels,
  hazardCategoryLabels,
  incidentTypeLabels,
  OPEN_ACTION_STATUSES,
  OPEN_HAZARD_STATUSES,
  permitTypeLabels,
  severityLabels,
} from "../hse.status";

/**
 * HSE reports (PRD #22 §199–§215).
 *
 * Every one aggregates in the database under the reader's own scope
 * (PRD #22 §424, §217): a project engineer's incident summary counts their
 * sites. Pulling rows into Node and counting them there would both be slow and
 * make it far too easy to count something the reader may not see.
 */

const MODULE = "hse" as const;

export const HSE_REPORTS = [
  { key: "inspection-summary", label: "Inspection summary", permission: "hse.inspection.view" },
  { key: "hazard-register", label: "Hazard register", permission: "hse.hazard.view" },
  { key: "risk-matrix", label: "Hazard risk matrix", permission: "hse.hazard.view" },
  { key: "critical-hazards", label: "Open critical hazards", permission: "hse.hazard.view" },
  { key: "incident-summary", label: "Incident summary", permission: "hse.incident.view" },
  { key: "incident-trend", label: "Incident trend", permission: "hse.incident.view" },
  { key: "incident-severity", label: "Incident severity", permission: "hse.incident.view" },
  { key: "risk-register", label: "Risk assessment register", permission: "hse.risk.view" },
  { key: "action-report", label: "HSE actions", permission: "hse.action.view" },
  { key: "toolbox-summary", label: "Toolbox talks", permission: "hse.toolbox.view" },
  { key: "permit-register", label: "Permit register", permission: "hse.permit.view" },
  { key: "expiring-permits", label: "Expiring permits", permission: "hse.permit.view" },
  { key: "ppe-summary", label: "PPE checks", permission: "hse.ppe.view" },
  { key: "environmental-register", label: "Environmental register", permission: "hse.environment.view" },
  { key: "stop-work-register", label: "Stop-work register", permission: "hse.report.view" },
] as const;

export type HseReportKey = (typeof HSE_REPORTS)[number]["key"];

export function availableReports(context: UserContext) {
  return HSE_REPORTS.filter((report) => can(context, report.permission));
}

export type ReportRow = Record<string, string | number | null>;

export type ReportResult = {
  key: string;
  label: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: ReportRow[];
  /**
   * A bounded register's true number of matching records, and the row bound
   * it stopped at (AUD-08 §4, DT-01): when `total > limit` the page says so
   * and points at the full, paged list instead of truncating silently.
   * Absent on aggregates and complete lists.
   */
  total?: number;
  limit?: number;
  /** The 5×5 grid, only for the risk matrix (PRD #22 §202). */
  matrix?: {
    likelihood: number;
    severity: number;
    count: number;
    score: number;
    level: string;
  }[];
};

export async function runReport(
  context: UserContext,
  key: string,
  options: { projectId?: string } = {},
): Promise<ReportResult> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.report.view");

  const report = HSE_REPORTS.find((candidate) => candidate.key === key);
  if (!report) {
    throw new AccessError("VALIDATION_ERROR", "That report does not exist.", {
      code: "UNKNOWN_REPORT",
    });
  }

  // The report's own permission, on top of `hse.report.view`: a reader who may
  // see reports but not incidents does not get an incident summary.
  assertPermission(context, report.permission);

  const project = options.projectId ? { projectId: options.projectId } : {};

  switch (key) {
    case "inspection-summary":
      return inspectionSummary(context, project, report.label);
    case "hazard-register":
      return hazardRegister(context, project, report.label);
    case "risk-matrix":
      return riskMatrix(context, project, report.label);
    case "critical-hazards":
      return criticalHazards(context, project, report.label);
    case "incident-summary":
      return incidentSummary(context, project, report.label);
    case "incident-trend":
      return incidentTrend(context, project, report.label);
    case "incident-severity":
      return incidentSeverity(context, project, report.label);
    case "risk-register":
      return riskRegister(context, project, report.label);
    case "action-report":
      return actionReport(context, project, report.label);
    case "toolbox-summary":
      return toolboxSummary(context, project, report.label);
    case "permit-register":
      return permitRegister(context, project, report.label);
    case "expiring-permits":
      return expiringPermits(context, project, report.label);
    case "ppe-summary":
      return ppeSummary(context, project, report.label);
    case "environmental-register":
      return environmentalRegister(context, project, report.label);
    case "stop-work-register":
      return stopWorkRegister(context, project, report.label);
    default:
      throw new AccessError("VALIDATION_ERROR", "That report does not exist.", {
        code: "UNKNOWN_REPORT",
      });
  }
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

async function inspectionSummary(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where = { ...buildInspectionScopeWhere(context), ...project };

  const [byResult, byStatus, total] = await Promise.all([
    prisma.hseInspection.groupBy({ by: ["result"], where, _count: { _all: true } }),
    prisma.hseInspection.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.hseInspection.count({ where }),
  ]);

  const resultCount = (value: string) =>
    byResult.find((row) => row.result === value)?._count._all ?? 0;
  const statusCount = (value: string) =>
    byStatus.find((row) => row.status === value)?._count._all ?? 0;

  return {
    key: "inspection-summary",
    label,
    columns: [
      { key: "metric", label: "Metric" },
      { key: "count", label: "Count", numeric: true },
    ],
    rows: [
      { metric: "Total", count: total },
      { metric: "Pass", count: resultCount("PASS") },
      { metric: "Fail", count: resultCount("FAIL") },
      { metric: "Conditional", count: resultCount("CONDITIONAL") },
      { metric: "Pending approval", count: statusCount("PENDING_APPROVAL") },
      { metric: "Closed", count: statusCount("CLOSED") },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Hazards                                                                     */
/* -------------------------------------------------------------------------- */

async function hazardRegister(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where: Prisma.HseHazardWhereInput = { ...buildHazardScopeWhere(context), ...project };
  // A bounded register: the first 500 rows in a stable order (the id
  // breaks ties) and the true total from the same snapshot, so the page can
  // say where it stopped instead of stopping silently (AUD-08 §4, DT-01).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.hseHazard.findMany({
        where,
        orderBy: [{ riskScore: "desc" }, { observedAt: "desc" }, { id: "asc" }],
        take: 500,
        select: {
          hazardNumber: true,
          title: true,
          hazardCategory: true,
          riskLevel: true,
          riskScore: true,
          residualRiskLevel: true,
          status: true,
          observedAt: true,
          dueDate: true,
          project: { select: { code: true } },
          assignedTo: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.hseHazard.count({ where }),
    ],
    SNAPSHOT,
  );

  const now = Date.now();

  return {
    total,
    limit: 500,
    key: "hazard-register",
    label,
    columns: [
      { key: "hazard", label: "Hazard" },
      { key: "project", label: "Project" },
      { key: "category", label: "Category" },
      { key: "initialRisk", label: "Initial risk" },
      { key: "residualRisk", label: "Residual risk" },
      { key: "assignedTo", label: "Assigned to" },
      { key: "due", label: "Due" },
      { key: "status", label: "Status" },
      { key: "ageDays", label: "Age (days)", numeric: true },
    ],
    rows: rows.map((row) => ({
      hazard: `${row.hazardNumber} — ${row.title}`,
      project: row.project?.code ?? null,
      category: hazardCategoryLabels[row.hazardCategory],
      initialRisk: `${riskLevelLabels[row.riskLevel]} (${row.riskScore})`,
      residualRisk: row.residualRiskLevel ? riskLevelLabels[row.residualRiskLevel] : null,
      assignedTo: row.assignedTo
        ? `${row.assignedTo.user.firstName} ${row.assignedTo.user.lastName}`
        : null,
      due: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
      status: row.status,
      ageDays: Math.floor((now - row.observedAt.getTime()) / 86_400_000),
    })),
  };
}

/**
 * The 5×5 grid with a count of open hazards in each cell (PRD #22 §202).
 *
 * Every cell is emitted, including the empty ones, and each carries its score
 * and level as text — the grid must not be readable only by colour
 * (PRD #22 §358).
 */
async function riskMatrix(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const grouped = await prisma.hseHazard.groupBy({
    by: ["likelihood", "severityScore"],
    where: {
      ...buildHazardScopeWhere(context),
      ...project,
      status: { in: OPEN_HAZARD_STATUSES },
    },
    _count: { _all: true },
  });

  const counts = new Map(
    grouped.map((row) => [`${row.likelihood}:${row.severityScore}`, row._count._all]),
  );

  const matrix = RISK_AXIS.flatMap((likelihood) =>
    RISK_AXIS.map((severity) => {
      const score = likelihood * severity;
      return {
        likelihood,
        severity,
        count: counts.get(`${likelihood}:${severity}`) ?? 0,
        score,
        level: calculateRiskLevel(score),
      };
    }),
  );

  return {
    key: "risk-matrix",
    label,
    columns: [
      { key: "likelihood", label: "Likelihood", numeric: true },
      { key: "severity", label: "Severity", numeric: true },
      { key: "score", label: "Score", numeric: true },
      { key: "level", label: "Risk level" },
      { key: "count", label: "Open hazards", numeric: true },
    ],
    rows: matrix
      .filter((cell) => cell.count > 0)
      .map((cell) => ({
        likelihood: cell.likelihood,
        severity: cell.severity,
        score: cell.score,
        level: riskLevelLabels[cell.level],
        count: cell.count,
      })),
    matrix,
  };
}

async function criticalHazards(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where: Prisma.HseHazardWhereInput = {
    ...buildHazardScopeWhere(context),
    ...project,
    riskLevel: "CRITICAL",
    status: { in: OPEN_HAZARD_STATUSES },
  };
  // A bounded register: the first 200 rows in a stable order (the id
  // breaks ties) and the true total from the same snapshot, so the page can
  // say where it stopped instead of stopping silently (AUD-08 §4, DT-01).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.hseHazard.findMany({
        where,
        orderBy: [{ observedAt: "asc" }, { id: "asc" }],
        take: 200,
        select: {
          hazardNumber: true,
          title: true,
          riskScore: true,
          status: true,
          observedAt: true,
          immediateControl: true,
          project: { select: { code: true } },
          assignedTo: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.hseHazard.count({ where }),
    ],
    SNAPSHOT,
  );

  return {
    total,
    limit: 200,
    key: "critical-hazards",
    label,
    columns: [
      { key: "hazard", label: "Hazard" },
      { key: "project", label: "Project" },
      { key: "score", label: "Score", numeric: true },
      { key: "control", label: "Immediate control" },
      { key: "assignedTo", label: "Assigned to" },
      { key: "status", label: "Status" },
      { key: "observed", label: "Observed" },
    ],
    rows: rows.map((row) => ({
      hazard: `${row.hazardNumber} — ${row.title}`,
      project: row.project?.code ?? null,
      score: row.riskScore,
      control: row.immediateControl,
      assignedTo: row.assignedTo
        ? `${row.assignedTo.user.firstName} ${row.assignedTo.user.lastName}`
        : null,
      status: row.status,
      observed: row.observedAt.toISOString().slice(0, 10),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

async function incidentSummary(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where = { ...buildIncidentScopeWhere(context), ...project };

  const [byType, serious, closed] = await Promise.all([
    prisma.hseIncident.groupBy({ by: ["incidentType"], where, _count: { _all: true } }),
    prisma.hseIncident.count({ where: { ...where, severity: { in: ["HIGH", "CRITICAL"] } } }),
    prisma.hseIncident.count({ where: { ...where, status: "CLOSED" } }),
  ]);

  const typeCount = (value: string) =>
    byType.find((row) => row.incidentType === value)?._count._all ?? 0;

  return {
    key: "incident-summary",
    label,
    columns: [
      { key: "metric", label: "Metric" },
      { key: "count", label: "Count", numeric: true },
    ],
    rows: [
      { metric: "Incidents", count: typeCount("INCIDENT") },
      { metric: "Near misses", count: typeCount("NEAR_MISS") },
      { metric: "First aid", count: typeCount("FIRST_AID") },
      { metric: "Property damage", count: typeCount("PROPERTY_DAMAGE") },
      { metric: "Environmental events", count: typeCount("ENVIRONMENTAL_EVENT") },
      { metric: "Vehicle events", count: typeCount("VEHICLE_EVENT") },
      { metric: "Fire events", count: typeCount("FIRE_EVENT") },
      { metric: "High / critical", count: serious },
      { metric: "Closed", count: closed },
    ],
  };
}

/** Grouped by month, twelve months back (PRD #22 §205). */
async function incidentTrend(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 11, 1);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.hseIncident.findMany({
    where: {
      ...buildIncidentScopeWhere(context),
      ...project,
      occurredAt: { gte: since },
    },
    select: { occurredAt: true, incidentType: true },
  });

  // Twelve buckets, always: a month with nothing in it is a fact about safety,
  // and a chart that skips it makes the trend look smoother than it was.
  const buckets = new Map<string, { incidents: number; nearMisses: number }>();
  for (let index = 0; index < 12; index += 1) {
    const date = new Date(since);
    date.setUTCMonth(since.getUTCMonth() + index);
    buckets.set(date.toISOString().slice(0, 7), { incidents: 0, nearMisses: 0 });
  }

  for (const row of rows) {
    const key = row.occurredAt.toISOString().slice(0, 7);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (row.incidentType === "NEAR_MISS") bucket.nearMisses += 1;
    else bucket.incidents += 1;
  }

  return {
    key: "incident-trend",
    label,
    columns: [
      { key: "month", label: "Month" },
      { key: "incidents", label: "Incidents", numeric: true },
      { key: "nearMisses", label: "Near misses", numeric: true },
    ],
    rows: [...buckets.entries()].map(([month, counts]) => ({
      month,
      incidents: counts.incidents,
      nearMisses: counts.nearMisses,
    })),
  };
}

async function incidentSeverity(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const grouped = await prisma.hseIncident.groupBy({
    by: ["severity"],
    where: { ...buildIncidentScopeWhere(context), ...project },
    _count: { _all: true },
  });

  const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

  return {
    key: "incident-severity",
    label,
    columns: [
      { key: "severity", label: "Severity" },
      { key: "count", label: "Count", numeric: true },
    ],
    rows: order.map((severity) => ({
      severity: severityLabels[severity],
      count: grouped.find((row) => row.severity === severity)?._count._all ?? 0,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Risk assessments                                                            */
/* -------------------------------------------------------------------------- */

async function riskRegister(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where: Prisma.HseRiskAssessmentWhereInput = { ...buildRiskAssessmentScopeWhere(context), ...project };
  // A bounded register: the first 500 rows in a stable order (the id
  // breaks ties) and the true total from the same snapshot, so the page can
  // say where it stopped instead of stopping silently (AUD-08 §4, DT-01).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.hseRiskAssessment.findMany({
        where,
        orderBy: [{ assessmentNumber: "asc" }, { version: "desc" }, { id: "asc" }],
        take: 500,
        select: {
          assessmentNumber: true,
          title: true,
          version: true,
          status: true,
          assessmentDate: true,
          reviewDate: true,
          project: { select: { code: true } },
          owner: { select: { user: { select: { firstName: true, lastName: true } } } },
          items: { select: { riskLevel: true } },
        },
      }),
      prisma.hseRiskAssessment.count({ where }),
    ],
    SNAPSHOT,
  );

  const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

  return {
    total,
    limit: 500,
    key: "risk-register",
    label,
    columns: [
      { key: "assessment", label: "Assessment" },
      { key: "project", label: "Project" },
      { key: "version", label: "Version", numeric: true },
      { key: "assessmentDate", label: "Assessed" },
      { key: "reviewDate", label: "Review" },
      { key: "highestRisk", label: "Highest risk" },
      { key: "status", label: "Status" },
      { key: "owner", label: "Owner" },
    ],
    rows: rows.map((row) => {
      const highest = row.items.reduce<string | null>(
        (worst, item) =>
          worst === null || order.indexOf(item.riskLevel) > order.indexOf(worst)
            ? item.riskLevel
            : worst,
        null,
      );

      return {
        assessment: `${row.assessmentNumber} — ${row.title}`,
        project: row.project?.code ?? null,
        version: row.version,
        assessmentDate: row.assessmentDate.toISOString().slice(0, 10),
        reviewDate: row.reviewDate ? row.reviewDate.toISOString().slice(0, 10) : null,
        highestRisk: highest ? riskLevelLabels[highest as keyof typeof riskLevelLabels] : null,
        status: row.status,
        owner: row.owner ? `${row.owner.user.firstName} ${row.owner.user.lastName}` : null,
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

async function actionReport(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where: Prisma.HseActionWhereInput = { ...buildActionScopeWhere(context), ...project };
  // A bounded register: the first 500 rows in a stable order (the id
  // breaks ties) and the true total from the same snapshot, so the page can
  // say where it stopped instead of stopping silently (AUD-08 §4, DT-01).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.hseAction.findMany({
        where,
        orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: 500,
        select: {
          actionNumber: true,
          title: true,
          priority: true,
          status: true,
          dueDate: true,
          project: { select: { code: true } },
          assignedTo: { select: { user: { select: { firstName: true, lastName: true } } } },
          hazard: { select: { hazardNumber: true } },
          incident: { select: { incidentNumber: true } },
          inspection: { select: { inspectionNumber: true } },
          riskAssessment: { select: { assessmentNumber: true } },
          environmentalObservation: { select: { observationNumber: true } },
          stopWork: { select: { stopWorkNumber: true } },
          permit: { select: { permitNumber: true } },
        },
      }),
      prisma.hseAction.count({ where }),
    ],
    SNAPSHOT,
  );

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  return {
    total,
    limit: 500,
    key: "action-report",
    label,
    columns: [
      { key: "action", label: "Action" },
      { key: "source", label: "Source" },
      { key: "project", label: "Project" },
      { key: "priority", label: "Priority" },
      { key: "assignedTo", label: "Assigned to" },
      { key: "due", label: "Due" },
      { key: "status", label: "Status" },
      { key: "daysOverdue", label: "Days overdue", numeric: true },
    ],
    rows: rows.map((row) => {
      const open = OPEN_ACTION_STATUSES.includes(row.status);
      const overdue =
        open && row.dueDate != null && row.dueDate.getTime() < midnight.getTime();

      return {
        action: `${row.actionNumber} — ${row.title}`,
        source:
          row.hazard?.hazardNumber ??
          row.incident?.incidentNumber ??
          row.inspection?.inspectionNumber ??
          row.riskAssessment?.assessmentNumber ??
          row.environmentalObservation?.observationNumber ??
          row.stopWork?.stopWorkNumber ??
          row.permit?.permitNumber ??
          null,
        project: row.project?.code ?? null,
        priority: row.priority,
        assignedTo: row.assignedTo
          ? `${row.assignedTo.user.firstName} ${row.assignedTo.user.lastName}`
          : null,
        due: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
        status: row.status,
        daysOverdue: overdue
          ? Math.floor((midnight.getTime() - row.dueDate!.getTime()) / 86_400_000)
          : 0,
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Toolbox                                                                     */
/* -------------------------------------------------------------------------- */

/** Counts and topics. No compliance percentage (PRD #22 §209). */
async function toolboxSummary(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where: Prisma.ToolboxTalkWhereInput = { ...buildToolboxScopeWhere(context), ...project, status: "COMPLETED" };
  // A bounded register: the first 500 rows in a stable order (the id
  // breaks ties) and the true total from the same snapshot, so the page can
  // say where it stopped instead of stopping silently (AUD-08 §4, DT-01).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.toolboxTalk.findMany({
        where,
        orderBy: [{ talkDate: "desc" }, { id: "asc" }],
        take: 500,
        select: {
          talkNumber: true,
          title: true,
          topic: true,
          talkDate: true,
          project: { select: { code: true } },
          conductedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
          participants: { select: { attendanceStatus: true } },
        },
      }),
      prisma.toolboxTalk.count({ where }),
    ],
    SNAPSHOT,
  );

  return {
    total,
    limit: 500,
    key: "toolbox-summary",
    label,
    columns: [
      { key: "talk", label: "Talk" },
      { key: "topic", label: "Topic" },
      { key: "project", label: "Project" },
      { key: "date", label: "Date" },
      { key: "conductedBy", label: "Conducted by" },
      { key: "attended", label: "Attended", numeric: true },
      { key: "participants", label: "Participants", numeric: true },
    ],
    rows: rows.map((row) => ({
      talk: `${row.talkNumber} — ${row.title}`,
      topic: row.topic,
      project: row.project?.code ?? null,
      date: row.talkDate.toISOString().slice(0, 10),
      conductedBy: row.conductedBy
        ? `${row.conductedBy.user.firstName} ${row.conductedBy.user.lastName}`
        : null,
      attended: row.participants.filter((p) => p.attendanceStatus === "ATTENDED").length,
      participants: row.participants.length,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Permits                                                                     */
/* -------------------------------------------------------------------------- */

async function permitRegister(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where: Prisma.HseWorkPermitWhereInput = { ...buildPermitScopeWhere(context), ...project };
  // A bounded register: the first 500 rows in a stable order (the id
  // breaks ties) and the true total from the same snapshot, so the page can
  // say where it stopped instead of stopping silently (AUD-08 §4, DT-01).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.hseWorkPermit.findMany({
        where,
        orderBy: [{ validFrom: "desc" }, { id: "asc" }],
        take: 500,
        select: {
          permitNumber: true,
          permitType: true,
          title: true,
          status: true,
          locationText: true,
          validFrom: true,
          validUntil: true,
          project: { select: { code: true } },
          responsible: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.hseWorkPermit.count({ where }),
    ],
    SNAPSHOT,
  );

  const now = Date.now();

  return {
    total,
    limit: 500,
    key: "permit-register",
    label,
    columns: [
      { key: "permit", label: "Permit" },
      { key: "type", label: "Type" },
      { key: "project", label: "Project" },
      { key: "location", label: "Location" },
      { key: "validFrom", label: "Valid from" },
      { key: "validUntil", label: "Valid until" },
      { key: "responsible", label: "Responsible" },
      { key: "status", label: "Status" },
    ],
    rows: rows.map((row) => ({
      permit: `${row.permitNumber} — ${row.title}`,
      type: permitTypeLabels[row.permitType],
      project: row.project?.code ?? null,
      location: row.locationText,
      validFrom: row.validFrom.toISOString().slice(0, 10),
      validUntil: row.validUntil.toISOString().slice(0, 10),
      responsible: row.responsible
        ? `${row.responsible.user.firstName} ${row.responsible.user.lastName}`
        : null,
      // Read through the clock, so the register never claims a lapsed permit is
      // still active (PRD #22 §151, §360).
      status:
        row.status !== "CLOSED" &&
        row.status !== "CANCELLED" &&
        row.validUntil.getTime() < now
          ? "EXPIRED"
          : row.status,
    })),
  };
}

/** Bucketed by how soon they run out (PRD #22 §211). */
async function expiringPermits(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 86_400_000);

  const rows = await prisma.hseWorkPermit.findMany({
    where: {
      ...buildPermitScopeWhere(context),
      ...project,
      status: { in: ["ACTIVE", "APPROVED", "SUSPENDED"] },
      validUntil: { gte: now, lte: horizon },
    },
    orderBy: [{ validUntil: "asc" }, { id: "asc" }],
    select: {
      permitNumber: true,
      permitType: true,
      title: true,
      validUntil: true,
      status: true,
      project: { select: { code: true } },
    },
  });

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const bucketFor = (validUntil: Date) => {
    const hours = (validUntil.getTime() - now.getTime()) / 3_600_000;
    if (validUntil <= endOfToday) return "Expires today";
    if (hours <= 24) return "Next 24 hours";
    if (hours <= 72) return "Next 3 days";
    return "Next 7 days";
  };

  return {
    key: "expiring-permits",
    label,
    columns: [
      { key: "bucket", label: "Expires" },
      { key: "permit", label: "Permit" },
      { key: "type", label: "Type" },
      { key: "project", label: "Project" },
      { key: "validUntil", label: "Valid until" },
      { key: "status", label: "Status" },
    ],
    rows: rows.map((row) => ({
      bucket: bucketFor(row.validUntil),
      permit: `${row.permitNumber} — ${row.title}`,
      type: permitTypeLabels[row.permitType],
      project: row.project?.code ?? null,
      validUntil: row.validUntil.toISOString().slice(0, 16).replace("T", " "),
      status: row.status,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* PPE and environment                                                         */
/* -------------------------------------------------------------------------- */

async function ppeSummary(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where = { ...buildPpeScopeWhere(context), ...project };

  const [grouped, failures] = await Promise.all([
    prisma.ppeCheck.groupBy({ by: ["result"], where, _count: { _all: true } }),
    // Which item of equipment fails most often, which is the one actionable
    // thing a PPE report can say (PRD #22 §212).
    prisma.ppeCheck.findMany({
      where: { ...where, result: "FAIL" },
      select: {
        helmetOk: true,
        eyeProtectionOk: true,
        hearingProtectionOk: true,
        respiratoryProtectionOk: true,
        glovesOk: true,
        harnessOk: true,
        footwearOk: true,
      },
    }),
  ]);

  const items: [string, keyof (typeof failures)[number]][] = [
    ["Helmet", "helmetOk"],
    ["Eye protection", "eyeProtectionOk"],
    ["Hearing protection", "hearingProtectionOk"],
    ["Respiratory protection", "respiratoryProtectionOk"],
    ["Gloves", "glovesOk"],
    ["Harness", "harnessOk"],
    ["Footwear", "footwearOk"],
  ];

  const rows: ReportRow[] = [
    { metric: "Pass", count: grouped.find((r) => r.result === "PASS")?._count._all ?? 0 },
    { metric: "Fail", count: grouped.find((r) => r.result === "FAIL")?._count._all ?? 0 },
    {
      metric: "Conditional",
      count: grouped.find((r) => r.result === "CONDITIONAL")?._count._all ?? 0,
    },
  ];

  for (const [itemLabel, key] of items) {
    const count = failures.filter((row) => row[key] === false).length;
    if (count > 0) rows.push({ metric: `${itemLabel} failures`, count });
  }

  return {
    key: "ppe-summary",
    label,
    columns: [
      { key: "metric", label: "Metric" },
      { key: "count", label: "Count", numeric: true },
    ],
    rows,
  };
}

async function environmentalRegister(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  const where: Prisma.EnvironmentalObservationWhereInput = { ...buildObservationScopeWhere(context), ...project };
  // A bounded register: the first 500 rows in a stable order (the id
  // breaks ties) and the true total from the same snapshot, so the page can
  // say where it stopped instead of stopping silently (AUD-08 §4, DT-01).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.environmentalObservation.findMany({
        where,
        orderBy: [{ observedAt: "desc" }, { id: "asc" }],
        take: 500,
        select: {
          observationNumber: true,
          title: true,
          category: true,
          severity: true,
          status: true,
          observedAt: true,
          dueDate: true,
          project: { select: { code: true } },
          assignedTo: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.environmentalObservation.count({ where }),
    ],
    SNAPSHOT,
  );

  const now = Date.now();

  return {
    total,
    limit: 500,
    key: "environmental-register",
    label,
    columns: [
      { key: "observation", label: "Observation" },
      { key: "project", label: "Project" },
      { key: "category", label: "Category" },
      { key: "severity", label: "Severity" },
      { key: "assignedTo", label: "Assigned to" },
      { key: "due", label: "Due" },
      { key: "status", label: "Status" },
      { key: "ageDays", label: "Age (days)", numeric: true },
    ],
    rows: rows.map((row) => ({
      observation: `${row.observationNumber} — ${row.title}`,
      project: row.project?.code ?? null,
      category: environmentalCategoryLabels[row.category],
      severity: severityLabels[row.severity],
      assignedTo: row.assignedTo
        ? `${row.assignedTo.user.firstName} ${row.assignedTo.user.lastName}`
        : null,
      due: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
      status: row.status,
      ageDays: Math.floor((now - row.observedAt.getTime()) / 86_400_000),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Stop work                                                                   */
/* -------------------------------------------------------------------------- */

async function stopWorkRegister(
  context: UserContext,
  project: { projectId?: string },
  label: string,
): Promise<ReportResult> {
  if (!can(context, "hse.stop_work.view")) throw new AccessError("FORBIDDEN");

  const where: Prisma.StopWorkRecordWhereInput = { ...buildStopWorkScopeWhere(context), ...project };
  // A bounded register: the first 500 rows in a stable order (the id
  // breaks ties) and the true total from the same snapshot, so the page can
  // say where it stopped instead of stopping silently (AUD-08 §4, DT-01).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.stopWorkRecord.findMany({
        where,
        orderBy: [{ status: "asc" }, { issuedAt: "desc" }, { id: "asc" }],
        take: 500,
        select: {
          stopWorkNumber: true,
          title: true,
          status: true,
          issuedAt: true,
          releasedAt: true,
          project: { select: { code: true } },
          issuedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.stopWorkRecord.count({ where }),
    ],
    SNAPSHOT,
  );

  return {
    total,
    limit: 500,
    key: "stop-work-register",
    label,
    columns: [
      { key: "stopWork", label: "Stop work" },
      { key: "project", label: "Project" },
      { key: "issuedAt", label: "Issued" },
      { key: "issuedBy", label: "Issued by" },
      { key: "status", label: "Status" },
      { key: "releasedAt", label: "Released" },
    ],
    rows: rows.map((row) => ({
      stopWork: `${row.stopWorkNumber} — ${row.title}`,
      project: row.project?.code ?? null,
      issuedAt: row.issuedAt.toISOString().slice(0, 10),
      issuedBy: row.issuedBy
        ? `${row.issuedBy.user.firstName} ${row.issuedBy.user.lastName}`
        : null,
      status: row.status,
      releasedAt: row.releasedAt ? row.releasedAt.toISOString().slice(0, 10) : null,
    })),
  };
}

/** Incident types, for a report filter. */
export { incidentTypeLabels };
