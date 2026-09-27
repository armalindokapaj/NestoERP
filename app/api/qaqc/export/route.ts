import { withContext } from "@/lib/api/respond";
import { exportResponse, recordExport } from "@/lib/core/export/exporter";
import { exportSelector } from "@/lib/core/export/export-params";
import { exportQaqc, parseQaqcExport, QAQC_EXPORT_TYPES } from "@/lib/modules/qaqc/qaqc.export";

/**
 * CSV export (PRD #21 §201, §202; AUD-08 §7).
 *
 * The same query, the same services and the same scope as the screen — so the
 * file can never contain a row the reader could not open, and holds every row
 * the list matches. The `qaqc.export` grant is checked on top of the view
 * permission for whatever is exported. `kind`, not `type`, picks the file: the
 * lists already use `type` for the inspection-type filter, and the export
 * control copies the whole query string. An unknown kind or filter is refused.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const type = exportSelector(params, "kind", QAQC_EXPORT_TYPES, "inspections");
    const prepared = await exportQaqc(context, type, parseQaqcExport(context, type, params));
    await recordExport(context, { id: "qaqc", module: "qaqc", filename: prepared.filename });
    return exportResponse(prepared);
  });
}
