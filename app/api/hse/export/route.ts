import { withContext } from "@/lib/api/respond";
import { exportHse, type HseExportKind } from "@/lib/modules/hse/hse.export";
import {
  actionListSchema,
  hazardListSchema,
  incidentListSchema,
  inspectionListSchema,
  observationListSchema,
  permitListSchema,
  riskAssessmentListSchema,
  toolboxListSchema,
} from "@/lib/modules/hse/hse.schema";

/**
 * CSV export (PRD #22 §216, §217).
 *
 * The same query, the same services and the same scope as the screen — so the
 * file can never contain a row the reader could not open. The `hse.export`
 * grant is checked on top of the view permission for whatever is exported.
 */
const KINDS = [
  "inspections",
  "hazards",
  "incidents",
  "risk-assessments",
  "actions",
  "toolbox-talks",
  "permits",
  "environment",
] as const;

function list(params: URLSearchParams, key: string): string[] | undefined {
  const raw = params.get(key);
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    /*
     * `kind`, not `type`: the HSE lists already use type filters of their own
     * and the export link copies the whole query string. Two meanings on one
     * parameter is how a filter quietly becomes a 422 nobody can explain.
     */
    const raw = params.get("kind");
    const kind: HseExportKind = (KINDS as readonly string[]).includes(raw ?? "")
      ? (raw as HseExportKind)
      : "hazards";

    const shared = {
      search: params.get("search") ?? undefined,
      view: params.get("view") ?? undefined,
      sort: params.get("sort") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
    };

    const { filename, csv } = await exportHse(context, kind, {
      inspections: inspectionListSchema.parse({
        ...shared,
        status: list(params, "status"),
        result: list(params, "result"),
        inspectionType: list(params, "inspectionType"),
        assignedInspectorMemberId: params.get("assignedInspectorMemberId") ?? undefined,
      }),
      hazards: hazardListSchema.parse({
        ...shared,
        status: list(params, "status"),
        riskLevel: list(params, "riskLevel"),
        hazardCategory: list(params, "hazardCategory"),
        assignedToMemberId: params.get("assignedToMemberId") ?? undefined,
      }),
      incidents: incidentListSchema.parse({
        ...shared,
        status: list(params, "status"),
        incidentType: list(params, "incidentType"),
        severity: list(params, "severity"),
      }),
      riskAssessments: riskAssessmentListSchema.parse({
        ...shared,
        status: list(params, "status"),
      }),
      actions: actionListSchema.parse({
        ...shared,
        status: list(params, "status"),
        actionType: list(params, "actionType"),
        priority: list(params, "priority"),
        assignedToMemberId: params.get("assignedToMemberId") ?? undefined,
      }),
      toolbox: toolboxListSchema.parse({ ...shared, status: list(params, "status") }),
      permits: permitListSchema.parse({
        ...shared,
        status: list(params, "status"),
        permitType: list(params, "permitType"),
      }),
      environment: observationListSchema.parse({
        ...shared,
        status: list(params, "status"),
        category: list(params, "category"),
        severity: list(params, "severity"),
      }),
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
