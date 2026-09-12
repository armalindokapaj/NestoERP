import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import * as actions from "./corrective-actions/action.service";
import * as defects from "./defects/defect.service";
import * as inspections from "./inspections/inspection.service";
import * as ncrs from "./ncrs/ncr.service";
import * as requests from "./requests/request.service";
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
  CorrectiveActionListQuery,
  DefectListQuery,
  InspectionListQuery,
  NcrListQuery,
  RequestListQuery,
} from "./qaqc.schema";

/**
 * CSV export (PRD #21 §201, §202).
 *
 * The export is the list. It parses the same query, calls the same service and
 * receives the same scoped DTOs — so the file can never contain a row the
 * reader could not open on screen.
 *
 * Status and result stay separate columns, because collapsing them into one is
 * exactly the confusion this module is built to avoid (§65).
 */

export const EXPORT_ROW_CAP = 10_000;

export type QaqcExportType =
  | "requests"
  | "inspections"
  | "defects"
  | "ncrs"
  | "corrective-actions";

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function day(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export async function exportQaqc(
  context: UserContext,
  type: QaqcExportType,
  query: {
    requests?: RequestListQuery;
    inspections?: InspectionListQuery;
    defects?: DefectListQuery;
    ncrs?: NcrListQuery;
    actions?: CorrectiveActionListQuery;
  },
): Promise<{ filename: string; csv: string }> {
  assertModule(context, "qaqc");
  assertPermission(context, "qaqc.export");

  const stamp = new Date().toISOString().slice(0, 10);

  if (type === "requests") {
    assertPermission(context, "qaqc.request.view");
    const result = await requests.listRequests(context, {
      ...query.requests!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    return {
      filename: `qaqc-requests-${stamp}.csv`,
      csv: toCsv(
        ["Request", "Title", "Type", "Status", "Priority", "Project", "Inspector", "Raised", "Needed by", "Overdue"],
        result.data.map((row) => [
          row.requestNumber,
          row.title,
          inspectionTypeLabels[row.inspectionType],
          requestStatusLabels[row.status],
          priorityLabels[row.priority],
          row.project?.code ?? null,
          row.assignedInspector?.fullName ?? null,
          day(row.requestedDate),
          day(row.requiredByDate),
          row.overdue ? "yes" : "no",
        ]),
      ),
    };
  }

  if (type === "inspections") {
    assertPermission(context, "qaqc.inspection.view");
    const result = await inspections.listInspections(context, {
      ...query.inspections!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    return {
      filename: `qaqc-inspections-${stamp}.csv`,
      csv: toCsv(
        // Two columns, never one: where it is, and what was found (§65).
        ["Inspection", "Type", "Status", "Result", "Project", "Inspector", "Template", "Date", "Reinspection of"],
        result.data.map((row) => [
          row.inspectionNumber,
          inspectionTypeLabels[row.inspectionType],
          inspectionStatusLabels[row.status],
          inspectionResultLabels[row.result],
          row.project?.code ?? null,
          row.assignedInspector?.fullName ?? null,
          row.templateName,
          day(row.inspectionDate),
          row.reinspectionSequence === null ? null : `sequence ${row.reinspectionSequence}`,
        ]),
      ),
    };
  }

  if (type === "defects") {
    assertPermission(context, "qaqc.defect.view");
    const result = await defects.listDefects(context, {
      ...query.defects!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    return {
      filename: `qaqc-defects-${stamp}.csv`,
      csv: toCsv(
        ["Defect", "Title", "Project", "Severity", "Status", "Assigned to", "Due", "Overdue"],
        result.data.map((row) => [
          row.defectNumber,
          row.title,
          row.project.code,
          severityLabels[row.severity],
          defectStatusLabels[row.status],
          row.assignedTo?.fullName ?? null,
          day(row.dueDate),
          row.overdue ? "yes" : "no",
        ]),
      ),
    };
  }

  if (type === "ncrs") {
    assertPermission(context, "qaqc.ncr.view");
    const result = await ncrs.listNcrs(context, {
      ...query.ncrs!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    return {
      filename: `qaqc-ncrs-${stamp}.csv`,
      csv: toCsv(
        ["NCR", "Title", "Category", "Severity", "Status", "Project", "Assigned to", "Open actions", "Due", "Overdue"],
        result.data.map((row) => [
          row.ncrNumber,
          row.title,
          ncrCategoryLabels[row.category],
          severityLabels[row.severity],
          ncrStatusLabels[row.status],
          row.project?.code ?? null,
          row.assignedTo?.fullName ?? null,
          row.openActions,
          day(row.dueDate),
          row.overdue ? "yes" : "no",
        ]),
      ),
    };
  }

  assertPermission(context, "qaqc.corrective_action.view");
  const result = await actions.listActions(context, {
    ...query.actions!,
    page: 1,
    limit: EXPORT_ROW_CAP,
  });

  return {
    filename: `qaqc-corrective-actions-${stamp}.csv`,
    csv: toCsv(
      ["Action", "Title", "Status", "Raised against", "Project", "Assigned to", "Due", "Overdue"],
      result.data.map((row) => [
        row.actionNumber,
        row.title,
        correctiveActionStatusLabels[row.status],
        row.parent ? `${row.parent.kind} ${row.parent.label}` : null,
        row.project?.code ?? null,
        row.assignedTo?.fullName ?? null,
        day(row.dueDate),
        row.overdue ? "yes" : "no",
      ]),
    ),
  };
}
