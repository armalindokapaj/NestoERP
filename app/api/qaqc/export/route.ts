import { withContext } from "@/lib/api/respond";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { exportQaqc, type QaqcExportType } from "@/lib/modules/qaqc/qaqc.export";
import {
  correctiveActionListQuerySchema,
  defectListQuerySchema,
  inspectionListQuerySchema,
  ncrListQuerySchema,
  requestListQuerySchema,
} from "@/lib/modules/qaqc/qaqc.schema";

/**
 * CSV export (PRD #21 §201, §202).
 *
 * The same query, the same services and the same scope as the screen — so the
 * file can never contain a row the reader could not open. The `qaqc.export`
 * grant is checked on top of the view permission for whatever is exported.
 */
const TYPES = ["requests", "inspections", "defects", "ncrs", "corrective-actions"] as const;

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
     * `kind`, not `type`: the QA/QC lists already use `type` for the
     * inspection-type filter, and the export link copies the whole query
     * string. Two meanings on one parameter is how a filter quietly becomes a
     * 422 nobody can explain.
     */
    const raw = params.get("kind");
    const type: QaqcExportType = (TYPES as readonly string[]).includes(raw ?? "")
      ? (raw as QaqcExportType)
      : "inspections";

    const shared = {
      search: params.get("search") ?? undefined,
      view: params.get("view") ?? undefined,
      sort: params.get("sort") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
    };

    const { filename, csv } = await exportQaqc(context, type, {
      requests: requestListQuerySchema.parse({
        ...shared,
        status: list(params, "status"),
        inspectionType: list(params, "type"),
        priority: list(params, "priority"),
      }),
      inspections: inspectionListQuerySchema.parse({
        ...shared,
        status: list(params, "status"),
        result: list(params, "result"),
        inspectionType: list(params, "inspectionType"),
      }),
      defects: defectListQuerySchema.parse({
        ...shared,
        status: list(params, "status"),
        severity: list(params, "severity"),
      }),
      ncrs: ncrListQuerySchema.parse({
        ...shared,
        status: list(params, "status"),
        severity: list(params, "severity"),
        category: list(params, "category"),
      }),
      actions: correctiveActionListQuerySchema.parse({
        ...shared,
        status: list(params, "status"),
        ncrId: params.get("ncrId") ?? undefined,
      }),
    });

    /*
     * Who took a copy of company data, and which one (PRD #28 §130). The row
     * counts and the filter values are not recorded — the evidence is that an
     * export happened, not a second copy of what left.
     */
    await recordUserAction(context, {
      actionKey: AuditAction.REPORT_EXPORTED_CSV,
      entity: { type: "export", id: "qaqc", label: filename },
      metadata: { module: "qaqc" },
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
