import { apiError, withContext } from "@/lib/api/respond";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { EXPORT_TYPES, exportSales, type SalesExportType } from "@/lib/modules/sales/sales.export";

/**
 * CSV export (PRD #17 §170, §171).
 *
 * The same query string the list page uses, so the file is a copy of the screen
 * rather than a second opinion about it.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "opportunities";

    if (!(EXPORT_TYPES as readonly string[]).includes(type)) {
      return apiError("VALIDATION_ERROR", "That export does not exist.");
    }

    const { filename, csv } = await exportSales(
      context,
      type as SalesExportType,
      url.searchParams,
    );

    /*
     * Who took a copy of company data, and which one (PRD #28 §130). The row
     * counts and the filter values are not recorded — the evidence is that an
     * export happened, not a second copy of what left.
     */
    await recordUserAction(context, {
      actionKey: AuditAction.REPORT_EXPORTED_CSV,
      entity: { type: "export", id: "sales", label: filename },
      metadata: { module: "sales" },
    });

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // A scoped export is per-user data: it must never be cached anywhere
        // shared (PRD #17 §171).
        "Cache-Control": "no-store",
      },
    });
  });
}
