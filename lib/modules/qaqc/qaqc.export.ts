import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prepareExport, type ExportColumn, type ExportLimits, type PreparedExport } from "@/lib/core/export/exporter";
import { assertApplied, assertExportParams, type ParamRules } from "@/lib/core/export/export-params";
import * as actions from "./corrective-actions/action.service";
import * as defects from "./defects/defect.service";
import * as inspections from "./inspections/inspection.service";
import * as ncrs from "./ncrs/ncr.service";
import * as requests from "./requests/request.service";
import {
  correctiveActionListQuerySchema,
  defectListQuerySchema,
  inspectionListQuerySchema,
  ncrListQuerySchema,
  requestListQuerySchema,
  type CorrectiveActionListQuery,
  type DefectListQuery,
  type InspectionListQuery,
  type NcrListQuery,
  type RequestListQuery,
} from "./qaqc.schema";
import {
  correctiveActionStatusLabels,
  defectStatusLabels,
  inspectionResultLabels,
  inspectionStatusLabels,
  inspectionTypeLabels,
  ncrCategoryLabels,
  ncrStatusLabels,
  priorityLabels,
  requestStatusLabels,
  severityLabels,
} from "./qaqc.status";
import type {
  CorrectiveActionSummaryDTO,
  DefectSummaryDTO,
  InspectionSummaryDTO,
  NcrSummaryDTO,
  RequestSummaryDTO,
} from "./qaqc.types";

/**
 * CSV export (PRD #21 §201, §202; AUD-08 §7).
 *
 * The export is the list. It reads the same parameters the list page reads —
 * `type` is the inspection-type filter there, so the file is picked by `kind` —
 * validates them with the list's own schemas (an unknown status or view is a
 * 422, never a dropped filter), calls the same service and receives the same
 * scoped DTOs — so the file can never contain a row the reader could not open
 * on screen, and holds every row the list matches, in its order.
 *
 * Status and result stay separate columns, because collapsing them into one is
 * exactly the confusion this module is built to avoid (§65). A project id from
 * another company, or one the reader cannot reach, matches nothing: the scope
 * is part of every list query (DT-22).
 *
 * Limits: 10,000 rows, 10 MiB, 30 s. Lines end LF, as this file always has.
 */

export const EXPORT_ROW_CAP = 10_000;
export const QAQC_EXPORT_LIMITS: Partial<ExportLimits> = { maxRows: EXPORT_ROW_CAP };
const LAYOUT = { lineBreak: "\n" } as const;

export const QAQC_EXPORT_TYPES = ["requests", "inspections", "defects", "ncrs", "corrective-actions"] as const;
export type QaqcExportType = (typeof QAQC_EXPORT_TYPES)[number];

export type QaqcExportQueries = {
  requests?: RequestListQuery;
  inspections?: InspectionListQuery;
  defects?: DefectListQuery;
  ncrs?: NcrListQuery;
  actions?: CorrectiveActionListQuery;
};

const SHARED: ParamRules = {
  search: { kind: "text" },
  view: { kind: "text", max: 40 },
  sort: { kind: "text", max: 40 },
  projectId: { kind: "id" },
};

/** Enumerated values are checked by the list schemas themselves; these rules allow the keys and shape the ids. */
export const QAQC_EXPORT_PARAMS: Record<QaqcExportType, ParamRules> = {
  requests: { ...SHARED, status: { kind: "text" }, type: { kind: "text" }, priority: { kind: "text" } },
  inspections: { ...SHARED, status: { kind: "text" }, result: { kind: "text" }, type: { kind: "text" }, inspectionType: { kind: "text" } },
  defects: { ...SHARED, status: { kind: "text" }, severity: { kind: "text" } },
  ncrs: { ...SHARED, status: { kind: "text" }, severity: { kind: "text" }, category: { kind: "text" } },
  "corrective-actions": { ...SHARED, status: { kind: "text" }, ncrId: { kind: "id" } },
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
 * The export's query string → the one list query for `type`, parsed exactly as
 * the list page parses it (`components/qaqc/qaqc-list.tsx`) but strictly.
 */
export function parseQaqcExport(context: UserContext, type: QaqcExportType, params: URLSearchParams): QaqcExportQueries {
  assertModule(context, "qaqc");
  assertPermission(context, "qaqc.export");
  assertExportParams(params, QAQC_EXPORT_PARAMS[type], { selector: ["kind"] });
  const shared = { search: one(params, "search"), view: one(params, "view"), sort: one(params, "sort"), projectId: one(params, "projectId") };
  const common = { view: "view", sort: "sort", status: "status" };
  switch (type) {
    case "requests": {
      const requests = requestListQuerySchema.parse({ ...shared, status: list(params, "status"), inspectionType: list(params, "type"), priority: list(params, "priority") });
      assertApplied(params, requests, { ...common, type: "inspectionType", priority: "priority" });
      return { requests };
    }
    case "inspections": {
      const inspections = inspectionListQuerySchema.parse({
        ...shared,
        status: list(params, "status"),
        result: list(params, "result"),
        inspectionType: list(params, "type") ?? list(params, "inspectionType"),
      });
      assertApplied(params, inspections, { ...common, result: "result", type: "inspectionType", inspectionType: "inspectionType" });
      return { inspections };
    }
    case "defects": {
      const defects = defectListQuerySchema.parse({ ...shared, status: list(params, "status"), severity: list(params, "severity") });
      assertApplied(params, defects, { ...common, severity: "severity" });
      return { defects };
    }
    case "ncrs": {
      const ncrs = ncrListQuerySchema.parse({ ...shared, status: list(params, "status"), severity: list(params, "severity"), category: list(params, "category") });
      assertApplied(params, ncrs, { ...common, severity: "severity", category: "category" });
      return { ncrs };
    }
    case "corrective-actions": {
      const actions = correctiveActionListQuerySchema.parse({ ...shared, status: list(params, "status"), ncrId: one(params, "ncrId") });
      assertApplied(params, actions, common);
      return { actions };
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

const yesNo = (value: boolean) => (value ? "yes" : "no");

export function requestColumns(context: UserContext): ExportColumn<RequestSummaryDTO>[] {
  return [
    company(context),
    { header: "Request ID", kind: "code", value: (row) => row.id },
    { header: "Request", kind: "code", value: (row) => row.requestNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Type", kind: "status", value: (row) => inspectionTypeLabels[row.inspectionType] },
    { header: "Status", kind: "status", value: (row) => requestStatusLabels[row.status] },
    { header: "Priority", kind: "status", value: (row) => priorityLabels[row.priority] },
    ...projectColumns<RequestSummaryDTO>(),
    { header: "Inspector", kind: "text", value: (row) => row.assignedInspector?.fullName },
    { header: "Raised", kind: "date", value: (row) => row.requestedDate },
    { header: "Needed by", kind: "date", value: (row) => row.requiredByDate },
    { header: "Overdue", kind: "text", value: (row) => yesNo(row.overdue) },
  ];
}

export function inspectionColumns(context: UserContext): ExportColumn<InspectionSummaryDTO>[] {
  return [
    company(context),
    { header: "Inspection ID", kind: "code", value: (row) => row.id },
    { header: "Inspection", kind: "code", value: (row) => row.inspectionNumber },
    { header: "Type", kind: "status", value: (row) => inspectionTypeLabels[row.inspectionType] },
    // Two columns, never one: where it is, and what was found (§65).
    { header: "Status", kind: "status", value: (row) => inspectionStatusLabels[row.status] },
    { header: "Result", kind: "status", value: (row) => inspectionResultLabels[row.result] },
    ...projectColumns<InspectionSummaryDTO>(),
    { header: "Inspector", kind: "text", value: (row) => row.assignedInspector?.fullName },
    { header: "Template", kind: "text", value: (row) => row.templateName },
    { header: "Date", kind: "date", value: (row) => row.inspectionDate },
    { header: "Reinspection of", kind: "code", value: (row) => row.parentInspectionId },
    { header: "Reinspection sequence", kind: "integer", value: (row) => row.reinspectionSequence },
  ];
}

export function defectColumns(context: UserContext): ExportColumn<DefectSummaryDTO>[] {
  return [
    company(context),
    { header: "Defect ID", kind: "code", value: (row) => row.id },
    { header: "Defect", kind: "code", value: (row) => row.defectNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Project ID", kind: "code", value: (row) => row.project.id },
    { header: "Project", kind: "code", value: (row) => row.project.code },
    { header: "Severity", kind: "status", value: (row) => severityLabels[row.severity] },
    { header: "Status", kind: "status", value: (row) => defectStatusLabels[row.status] },
    { header: "Assigned to", kind: "text", value: (row) => row.assignedTo?.fullName },
    { header: "Due", kind: "date", value: (row) => row.dueDate },
    { header: "Overdue", kind: "text", value: (row) => yesNo(row.overdue) },
  ];
}

export function ncrColumns(context: UserContext): ExportColumn<NcrSummaryDTO>[] {
  return [
    company(context),
    { header: "NCR ID", kind: "code", value: (row) => row.id },
    { header: "NCR", kind: "code", value: (row) => row.ncrNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Category", kind: "status", value: (row) => ncrCategoryLabels[row.category] },
    { header: "Severity", kind: "status", value: (row) => severityLabels[row.severity] },
    { header: "Status", kind: "status", value: (row) => ncrStatusLabels[row.status] },
    ...projectColumns<NcrSummaryDTO>(),
    { header: "Assigned to", kind: "text", value: (row) => row.assignedTo?.fullName },
    { header: "Open actions", kind: "integer", value: (row) => row.openActions },
    { header: "Due", kind: "date", value: (row) => row.dueDate },
    { header: "Overdue", kind: "text", value: (row) => yesNo(row.overdue) },
  ];
}

export function correctiveActionColumns(context: UserContext): ExportColumn<CorrectiveActionSummaryDTO>[] {
  return [
    company(context),
    { header: "Action ID", kind: "code", value: (row) => row.id },
    { header: "Action", kind: "code", value: (row) => row.actionNumber },
    { header: "Title", kind: "text", value: (row) => row.title },
    { header: "Status", kind: "status", value: (row) => correctiveActionStatusLabels[row.status] },
    { header: "Raised against", kind: "text", value: (row) => (row.parent ? `${row.parent.kind} ${row.parent.label}` : null) },
    { header: "Raised against ID", kind: "code", value: (row) => row.parent?.id },
    ...projectColumns<CorrectiveActionSummaryDTO>(),
    { header: "Assigned to", kind: "text", value: (row) => row.assignedTo?.fullName },
    { header: "Due", kind: "date", value: (row) => row.dueDate },
    { header: "Overdue", kind: "text", value: (row) => yesNo(row.overdue) },
  ];
}

export async function exportQaqc(
  context: UserContext,
  type: QaqcExportType,
  query: QaqcExportQueries,
  options: { evaluatedAt?: Date } = {},
): Promise<PreparedExport> {
  assertModule(context, "qaqc");
  assertPermission(context, "qaqc.export");

  const evaluatedAt = options.evaluatedAt ?? new Date();
  const stamp = evaluatedAt.toISOString().slice(0, 10);
  const shared = { limits: QAQC_EXPORT_LIMITS, layout: LAYOUT, evaluatedAt, filename: `qaqc-${type}-${stamp}.csv` };
  const page = { page: 1 };

  switch (type) {
    case "requests": {
      assertPermission(context, "qaqc.request.view");
      const base = query.requests ?? requestListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "qaqc.requests",
        columns: requestColumns(context),
        read: async (take) => {
          const result = await requests.listRequests(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "inspections": {
      assertPermission(context, "qaqc.inspection.view");
      const base = query.inspections ?? inspectionListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "qaqc.inspections",
        columns: inspectionColumns(context),
        read: async (take) => {
          const result = await inspections.listInspections(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "defects": {
      assertPermission(context, "qaqc.defect.view");
      const base = query.defects ?? defectListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "qaqc.defects",
        columns: defectColumns(context),
        read: async (take) => {
          const result = await defects.listDefects(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "ncrs": {
      assertPermission(context, "qaqc.ncr.view");
      const base = query.ncrs ?? ncrListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "qaqc.ncrs",
        columns: ncrColumns(context),
        read: async (take) => {
          const result = await ncrs.listNcrs(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
    case "corrective-actions": {
      assertPermission(context, "qaqc.corrective_action.view");
      const base = query.actions ?? correctiveActionListQuerySchema.parse({});
      return prepareExport({
        ...shared,
        id: "qaqc.corrective-actions",
        columns: correctiveActionColumns(context),
        read: async (take) => {
          const result = await actions.listActions(context, { ...base, ...page, limit: take });
          return { rows: result.data, total: result.pagination.total };
        },
      });
    }
  }
}
