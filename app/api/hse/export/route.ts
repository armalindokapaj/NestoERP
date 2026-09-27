import { withContext } from "@/lib/api/respond";
import { exportResponse, recordExport } from "@/lib/core/export/exporter";
import { exportSelector } from "@/lib/core/export/export-params";
import { exportHse, HSE_EXPORT_KINDS, parseHseExport } from "@/lib/modules/hse/hse.export";

/**
 * CSV export (PRD #22 §216, §217; AUD-08 §7).
 *
 * The same query, the same services and the same scope as the screen — so the
 * file can never contain a row the reader could not open, and holds every row
 * the list matches. The `hse.export` grant is checked on top of the view
 * permission for whatever is exported. `kind`, not `type`, picks the file: the
 * HSE lists already use type filters of their own and the export control copies
 * the whole query string. An unknown kind or filter is refused.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const kind = exportSelector(params, "kind", HSE_EXPORT_KINDS, "hazards");
    const prepared = await exportHse(context, kind, parseHseExport(context, kind, params));
    await recordExport(context, { id: "hse", module: "hse", filename: prepared.filename });
    return exportResponse(prepared);
  });
}
