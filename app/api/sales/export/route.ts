import { withContext } from "@/lib/api/respond";
import { exportResponse, recordExport } from "@/lib/core/export/exporter";
import { exportSelector } from "@/lib/core/export/export-params";
import { EXPORT_TYPES, exportSales } from "@/lib/modules/sales/sales.export";

/**
 * CSV export (PRD #17 §170, §171; AUD-08 §7).
 *
 * The list's own query string without the page: every matching record, in the
 * list's order, as one complete file — or a JSON refusal (an unknown export or
 * filter, past 1,000 rows), never a partial file. Reauthorised on every call.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const type = exportSelector(params, "type", EXPORT_TYPES, "opportunities");
    const prepared = await exportSales(context, type, params);
    await recordExport(context, { id: "sales", module: "sales", filename: prepared.filename });
    return exportResponse(prepared);
  });
}
