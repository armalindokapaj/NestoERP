import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prepareExport, type ExportColumn, type ExportLimits, type PreparedExport } from "@/lib/core/export/exporter";
import { assertApplied, assertExportParams, type ParamRules } from "@/lib/core/export/export-params";
import * as actions from "./actions/action.service";
import * as environment from "./environment/environment.service";
import * as hazards from "./hazards/hazard.service";
import {
  actionStatusLabels,
  actionTypeLabels,
  environmentalCategoryLabels,
  environmentalStatusLabels,
  hazardCategoryLabels,
  hazardStatusLabels,
  incidentStatusLabels,
  incidentTypeLabels,
  inspectionResultLabels,
  inspectionStatusLabels,
  inspectionTypeLabels,
  permitStatusLabels,
  permitTypeLabels,
  priorityLabels,
  riskAssessmentStatusLabels,
  severityLabels,
  toolboxStatusLabels,
} from "./hse.status";
import { riskLevelLabels } from "./hse.risk";
import * as incidents from "./incidents/incident.service";
import * as inspections from "./inspections/inspection.service";
import * as permits from "./permits/permit.service";
import * as risk from "./risk-assessments/risk.service";
import * as toolbox from "./toolbox/toolbox.service";
import {
  actionListSchema,
  hazardListSchema,
  incidentListSchema,
  inspectionListSchema,
  observationListSchema,
  permitListSchema,
  riskAssessmentListSchema,
  toolboxListSchema,
  type ActionListQuery,
  type HazardListQuery,
  type IncidentListQuery,
  type InspectionListQuery,
  type ObservationListQuery,
  type PermitListQuery,
  type RiskAssessmentListQuery,
  type ToolboxListQuery,
} from "./hse.schema";
import type {
  ActionSummaryDTO,
  HazardSummaryDTO,
  IncidentSummaryDTO,
  InspectionSummaryDTO,
  ObservationSummaryDTO,
  PermitSummaryDTO,
  RiskAssessmentSummaryDTO,
  ToolboxSummaryDTO,
} from "./hse.types";

/**
 * CSV export (PRD #22 §216, §217; AUD-08 §7).
 *
 * The export is the list. It reads the parameters the list page reads
 * (`components/hse/hse-list.tsx`), validates them with the list's own schemas
 * and refuses any the list would drop, calls the same service and receives the
 * same scoped DTOs — so the file can never contain a row the reader could not
 * open on screen, and holds every row the list matches, in its order.
 *
 * Two consequences worth stating. Status and result stay separate columns on an
 * inspection, because collapsing them is the confusion this module exists to
 * avoid (§37, §38). And an incident's injury flags are written only when the
 * DTO carried them: a reader whose `injury` came back null exports a file
 * without those columns filled, rather than a row of "No" that would read as an
 * answer (§22).
 *
 * Moments (an incident's occurrence, an observation, a permit's validity) are
 * ISO timestamps in UTC; business dates (due, scheduled, review) are days.
 *
 * Limits: 10,000 rows, 10 MiB, 30 s. Lines end LF.
 */

export const EXPORT_ROW_CAP = 10_000;
export const HSE_EXPORT_LIMITS: Partial<ExportLimits> = { maxRows: EXPORT_ROW_CAP };
const LAYOUT = { lineBreak: "\n" } as const;

export const HSE_EXPORT_KINDS = ["inspections", "hazards", "incidents", "risk-assessments", "actions", "toolbox-talks", "permits", "environment"] as const;
export type HseExportKind = (typeof HSE_EXPORT_KINDS)[number];

export type HseExportQueries = {
  inspections: InspectionListQuery;
  hazards: HazardListQuery;
  incidents: IncidentListQuery;
  riskAssessments: RiskAssessmentListQuery;
  actions: ActionListQuery;
  toolbox: ToolboxListQuery;
  permits: PermitListQuery;
  environment: ObservationListQuery;
};

const TEXT: ParamRules[string] = { kind: "text", max: 400 };
const SHARED: ParamRules = { search: TEXT, view: TEXT, sort: TEXT, projectId: { kind: "id" }, status: TEXT };

/** Keys each export takes (the list page's own); enumerated values are checked against the list's schema. */
export const HSE_EXPORT_PARAMS: Record<HseExportKind, ParamRules> = {
  inspections: { ...SHARED, result: TEXT, inspectionType: TEXT, assignedInspectorMemberId: { kind: "id" } },
  hazards: { ...SHARED, riskLevel: TEXT, hazardCategory: TEXT, assignedToMemberId: { kind: "id" } },
  incidents: { ...SHARED, incidentType: TEXT, severity: TEXT },
  "risk-assessments": SHARED,
  actions: { ...SHARED, actionType: TEXT, priority: TEXT, assignedToMemberId: { kind: "id" } },
  "toolbox-talks": SHARED,
  permits: { ...SHARED, permitType: TEXT },
  environment: { ...SHARED, category: TEXT, severity: TEXT },
};

function list(params: URLSearchParams, key: string): string[] | undefined {
  const raw = params.get(key);
  if (!raw) return undefined;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function one(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value : undefined;
}

/**
 * The export's query string → the one list query for `kind`, strictly. Only
 * that kind's filters are read (PRD #47 §69): each list has its own enums, and
 * parsing all eight turned a filter meaningful to one list into a 422 from
 * another.
 */
export function parseHseExport(context: UserContext, kind: HseExportKind, params: URLSearchParams): Partial<HseExportQueries> {
  assertModule(context, "hse");
  assertPermission(context, "hse.export");
  assertExportParams(params, HSE_EXPORT_PARAMS[kind], { selector: ["kind"] });
  const shared = { search: one(params, "search"), view: one(params, "view"), sort: one(params, "sort"), projectId: one(params, "projectId"), status: list(params, "status") };
  const common = { view: "view", sort: "sort", status: "status" };
  switch (kind) {
    case "inspections": {
      const query = inspectionListSchema.parse({ ...shared, result: list(params, "result"), inspectionType: list(params, "inspectionType"), assignedInspectorMemberId: one(params, "assignedInspectorMemberId") });
      assertApplied(params, query, { ...common, result: "result", inspectionType: "inspectionType" });
      return { inspections: query };
    }
    case "hazards": {
      const query = hazardListSchema.parse({ ...shared, riskLevel: list(params, "riskLevel"), hazardCategory: list(params, "hazardCategory"), assignedToMemberId: one(params, "assignedToMemberId") });
      assertApplied(params, query, { ...common, riskLevel: "riskLevel", hazardCategory: "hazardCategory" });
      return { hazards: query };
    }
    case "incidents": {
      const query = incidentListSchema.parse({ ...shared, incidentType: list(params, "incidentType"), severity: list(params, "severity") });
      assertApplied(params, query, { ...common, incidentType: "incidentType", severity: "severity" });
      return { incidents: query };
    }
    case "risk-assessments": {
      const query = riskAssessmentListSchema.parse(shared);
      assertApplied(params, query, common);
      return { riskAssessments: query };
    }
    case "actions": {
      const query = actionListSchema.parse({ ...shared, actionType: list(params, "actionType"), priority: list(params, "priority"), assignedToMemberId: one(params, "assignedToMemberId") });
      assertApplied(params, query, { ...common, actionType: "actionType", priority: "priority" });
      return { actions: query };
    }
    case "toolbox-talks": {
      const query = toolboxListSchema.parse(shared);
      assertApplied(params, query, { sort: "sort", status: "status" });
      return { toolbox: query };
    }
    case "permits": {
      const query = permitListSchema.parse({ ...shared, permitType: list(params, "permitType") });
      assertApplied(params, query, { ...common, permitType: "permitType" });
      return { permits: query };
    }
    case "environment": {
      const query = observationListSchema.parse({ ...shared, category: list(params, "category"), severity: list(params, "severity") });
      assertApplied(params, query, { ...common, category: "category", severity: "severity" });
      return { environment: query };
    }
  }
}

const company = (context: UserContext) => ({ header: "Company ID", kind: "code" as const, value: () => context.companyId });

function projectColumns<R extends { project: { id: string; code: string } | null }>(): ExportColumn<R>[] {
  return [
    { header: "Project ID", kind: "code", value: (row) => row.project?.id },
    { header: "Project", kind: "code", value: (row) => row.project?.code },
  ];
}

/** Blank, not "No", when the reader may not see the injury flags (§22). */
function injury(pick: (flags: NonNullable<IncidentSummaryDTO["injury"]>) => boolean) {
  return (row: IncidentSummaryDTO) => (row.injury ? pick(row.injury) : null);
}

export function inspectionColumns(context: UserContext): ExportColumn<InspectionSummaryDTO>[] {
  return [
    company(context),
    { header: "Inspection ID", kind: "code", value: (row) => row.id },
    { header: "Inspection", kind: "code", value: (row) => row.inspectionNumber },
    { header: "Type", kind: "status", value: (row) => inspectionTypeLabels[row.inspectionType] },
    { header: "Status", kind: "status", value: (row) => inspectionStatusLabels[row.status] },
    { header: "Result", kind: "status", value: (row) => inspectionResultLabels[row.result] },
    ...projectColumns<InspectionSummaryDTO>(),
    { header: "Inspector", kind: "text", value: (row) => row.assignedInspector?.fullName },
    { header: "Scheduled", kind: "date", value: (row) => row.scheduledDate },
    { header: "Inspected", kind: "date", value: (row) => row.inspectionDate },
    { header: "Location", kind: "text", value: (row) => row.locationText },
    { header: "Failed items", kind: "integer", value: (row) => row.failedItemCount },
  ];
}

export function hazardColumns(context: UserContext): ExportColumn<HazardSummaryDTO>[] {
  return [
    company(context),
    { header: "Hazard ID", kind: "code", value: (row) => row.id },
    { header: "Hazard", kind: "code", value: (row) => row.hazardNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Category", kind: "status", value: (row) => hazardCategoryLabels[row.hazardCategory] },
    { header: "Status", kind: "status", value: (row) => hazardStatusLabels[row.status] },
    { header: "Likelihood", kind: "integer", value: (row) => row.risk.likelihood },
    { header: "Severity", kind: "integer", value: (row) => row.risk.severity },
    { header: "Risk score", kind: "integer", value: (row) => row.risk.score },
    { header: "Risk level", kind: "status", value: (row) => riskLevelLabels[row.risk.level] },
    { header: "Residual score", kind: "integer", value: (row) => row.residualRisk?.score },
    { header: "Residual level", kind: "status", value: (row) => (row.residualRisk ? riskLevelLabels[row.residualRisk.level] : null) },
    ...projectColumns<HazardSummaryDTO>(),
    { header: "Assigned to", kind: "text", value: (row) => row.assignedTo?.fullName },
    { header: "Observed", kind: "datetime", value: (row) => row.observedAt },
    { header: "Due", kind: "date", value: (row) => row.dueDate },
    { header: "Overdue", kind: "boolean", value: (row) => row.overdue },
  ];
}

export function incidentColumns(context: UserContext): ExportColumn<IncidentSummaryDTO>[] {
  return [
    company(context),
    { header: "Incident ID", kind: "code", value: (row) => row.id },
    { header: "Incident", kind: "code", value: (row) => row.incidentNumber },
    { header: "Type", kind: "status", value: (row) => incidentTypeLabels[row.incidentType] },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Severity", kind: "status", value: (row) => severityLabels[row.severity] },
    { header: "Status", kind: "status", value: (row) => incidentStatusLabels[row.status] },
    ...projectColumns<IncidentSummaryDTO>(),
    { header: "Reported by", kind: "text", value: (row) => row.reportedBy?.fullName },
    { header: "Investigator", kind: "text", value: (row) => row.investigator?.fullName },
    { header: "Occurred", kind: "datetime", value: (row) => row.occurredAt },
    { header: "Reported", kind: "datetime", value: (row) => row.reportedAt },
    { header: "Injury", kind: "boolean", value: injury((flags) => flags.injuryOccurred) },
    { header: "First aid", kind: "boolean", value: injury((flags) => flags.firstAidRequired) },
    { header: "Medical treatment", kind: "boolean", value: injury((flags) => flags.medicalTreatmentRequired) },
    { header: "Lost time", kind: "boolean", value: injury((flags) => flags.lostTime) },
    { header: "Property damage", kind: "boolean", value: injury((flags) => flags.propertyDamage) },
    { header: "Environmental impact", kind: "boolean", value: injury((flags) => flags.environmentalImpact) },
  ];
}

export function riskAssessmentColumns(context: UserContext): ExportColumn<RiskAssessmentSummaryDTO>[] {
  return [
    company(context),
    { header: "Assessment ID", kind: "code", value: (row) => row.id },
    { header: "Assessment", kind: "code", value: (row) => row.assessmentNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Version", kind: "integer", value: (row) => row.version },
    { header: "Status", kind: "status", value: (row) => riskAssessmentStatusLabels[row.status] },
    ...projectColumns<RiskAssessmentSummaryDTO>(),
    { header: "Owner", kind: "text", value: (row) => row.owner?.fullName },
    { header: "Assessed", kind: "date", value: (row) => row.assessmentDate },
    { header: "Review", kind: "date", value: (row) => row.reviewDate },
    { header: "Review due", kind: "boolean", value: (row) => row.reviewDue },
    { header: "Highest risk", kind: "status", value: (row) => (row.highestRisk ? riskLevelLabels[row.highestRisk] : null) },
    { header: "Lines", kind: "integer", value: (row) => row.itemCount },
  ];
}

export function actionColumns(context: UserContext): ExportColumn<ActionSummaryDTO>[] {
  return [
    company(context),
    { header: "Action ID", kind: "code", value: (row) => row.id },
    { header: "Action", kind: "code", value: (row) => row.actionNumber },
    { header: "Type", kind: "status", value: (row) => actionTypeLabels[row.actionType] },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Priority", kind: "status", value: (row) => priorityLabels[row.priority] },
    { header: "Status", kind: "status", value: (row) => actionStatusLabels[row.status] },
    { header: "Source", kind: "text", value: (row) => row.source?.label },
    ...projectColumns<ActionSummaryDTO>(),
    { header: "Assigned to", kind: "text", value: (row) => row.assignedTo?.fullName },
    { header: "Due", kind: "date", value: (row) => row.dueDate },
    { header: "Days overdue", kind: "integer", value: (row) => row.daysOverdue },
  ];
}

export function toolboxColumns(context: UserContext): ExportColumn<ToolboxSummaryDTO>[] {
  return [
    company(context),
    { header: "Talk ID", kind: "code", value: (row) => row.id },
    { header: "Talk", kind: "code", value: (row) => row.talkNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Topic", kind: "text", value: (row) => row.topic },
    { header: "Status", kind: "status", value: (row) => toolboxStatusLabels[row.status] },
    ...projectColumns<ToolboxSummaryDTO>(),
    { header: "Conducted by", kind: "text", value: (row) => row.conductedBy?.fullName },
    { header: "Date", kind: "date", value: (row) => row.talkDate },
    { header: "Location", kind: "text", value: (row) => row.locationText },
    { header: "Attended", kind: "integer", value: (row) => row.attendedCount },
    { header: "Participants", kind: "integer", value: (row) => row.participantCount },
  ];
}

export function permitColumns(context: UserContext): ExportColumn<PermitSummaryDTO>[] {
  return [
    company(context),
    { header: "Permit ID", kind: "code", value: (row) => row.id },
    { header: "Permit", kind: "code", value: (row) => row.permitNumber },
    { header: "Type", kind: "status", value: (row) => permitTypeLabels[row.permitType] },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Status", kind: "status", value: (row) => permitStatusLabels[row.status] },
    // Both columns: the stored one and the one the clock says, because the
    // difference is the whole point (§151, §360).
    { header: "Effective status", kind: "status", value: (row) => permitStatusLabels[row.effectiveStatus] },
    { header: "Project ID", kind: "code", value: (row) => row.project.id },
    { header: "Project", kind: "code", value: (row) => row.project.code },
    { header: "Location", kind: "text", value: (row) => row.locationText },
    { header: "Requested by", kind: "text", value: (row) => row.requestedBy?.fullName },
    { header: "Responsible", kind: "text", value: (row) => row.responsible?.fullName },
    { header: "Valid from", kind: "datetime", value: (row) => row.validFrom },
    { header: "Valid until", kind: "datetime", value: (row) => row.validUntil },
  ];
}

export function observationColumns(context: UserContext): ExportColumn<ObservationSummaryDTO>[] {
  return [
    company(context),
    { header: "Observation ID", kind: "code", value: (row) => row.id },
    { header: "Observation", kind: "code", value: (row) => row.observationNumber },
    { header: "Category", kind: "status", value: (row) => environmentalCategoryLabels[row.category] },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Severity", kind: "status", value: (row) => severityLabels[row.severity] },
    { header: "Status", kind: "status", value: (row) => environmentalStatusLabels[row.status] },
    ...projectColumns<ObservationSummaryDTO>(),
    { header: "Reported by", kind: "text", value: (row) => row.reportedBy?.fullName },
    { header: "Assigned to", kind: "text", value: (row) => row.assignedTo?.fullName },
    { header: "Observed", kind: "datetime", value: (row) => row.observedAt },
    { header: "Due", kind: "date", value: (row) => row.dueDate },
    { header: "Overdue", kind: "boolean", value: (row) => row.overdue },
  ];
}

/**
 * Only the query for the kind being exported is needed (PRD #47 §69); a
 * missing one is the list's default.
 */
export async function exportHse(
  context: UserContext,
  kind: HseExportKind,
  given: Partial<HseExportQueries>,
  options: { evaluatedAt?: Date } = {},
): Promise<PreparedExport> {
  assertModule(context, "hse");
  assertPermission(context, "hse.export");

  const evaluatedAt = options.evaluatedAt ?? new Date();
  const stamp = evaluatedAt.toISOString().slice(0, 10);
  const shared = { limits: HSE_EXPORT_LIMITS, layout: LAYOUT, evaluatedAt };
  const page = { page: 1 };
  const read = <R>(run: (take: number) => Promise<{ data: R[]; pagination: { total: number } }>) => async (take: number) => {
    const result = await run(take);
    return { rows: result.data, total: result.pagination.total };
  };

  switch (kind) {
    case "inspections": {
      const base = given.inspections ?? inspectionListSchema.parse({});
      return prepareExport({ ...shared, id: "hse.inspections", filename: `hse-inspections-${stamp}.csv`, columns: inspectionColumns(context), read: read((take) => inspections.listInspections(context, { ...base, ...page, limit: take })) });
    }
    case "hazards": {
      const base = given.hazards ?? hazardListSchema.parse({});
      return prepareExport({ ...shared, id: "hse.hazards", filename: `hse-hazards-${stamp}.csv`, columns: hazardColumns(context), read: read((take) => hazards.listHazards(context, { ...base, ...page, limit: take })) });
    }
    case "incidents": {
      const base = given.incidents ?? incidentListSchema.parse({});
      return prepareExport({ ...shared, id: "hse.incidents", filename: `hse-incidents-${stamp}.csv`, columns: incidentColumns(context), read: read((take) => incidents.listIncidents(context, { ...base, ...page, limit: take })) });
    }
    case "risk-assessments": {
      const base = given.riskAssessments ?? riskAssessmentListSchema.parse({});
      return prepareExport({ ...shared, id: "hse.risk-assessments", filename: `hse-risk-assessments-${stamp}.csv`, columns: riskAssessmentColumns(context), read: read((take) => risk.listRiskAssessments(context, { ...base, ...page, limit: take })) });
    }
    case "actions": {
      const base = given.actions ?? actionListSchema.parse({});
      return prepareExport({ ...shared, id: "hse.actions", filename: `hse-actions-${stamp}.csv`, columns: actionColumns(context), read: read((take) => actions.listActions(context, { ...base, ...page, limit: take })) });
    }
    case "toolbox-talks": {
      const base = given.toolbox ?? toolboxListSchema.parse({});
      return prepareExport({ ...shared, id: "hse.toolbox-talks", filename: `hse-toolbox-talks-${stamp}.csv`, columns: toolboxColumns(context), read: read((take) => toolbox.listToolboxTalks(context, { ...base, ...page, limit: take })) });
    }
    case "permits": {
      const base = given.permits ?? permitListSchema.parse({});
      return prepareExport({ ...shared, id: "hse.permits", filename: `hse-permits-${stamp}.csv`, columns: permitColumns(context), read: read((take) => permits.listPermits(context, { ...base, ...page, limit: take })) });
    }
    case "environment": {
      const base = given.environment ?? observationListSchema.parse({});
      return prepareExport({ ...shared, id: "hse.environment", filename: `hse-environmental-${stamp}.csv`, columns: observationColumns(context), read: read((take) => environment.listObservations(context, { ...base, ...page, limit: take })) });
    }
  }
}
