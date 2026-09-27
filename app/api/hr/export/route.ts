import { withContext } from "@/lib/api/respond";
import { exportResponse, recordExport } from "@/lib/core/export/exporter";
import { exportSelector } from "@/lib/core/export/export-params";
import { EXPORT_TYPES, exportHr } from "@/lib/modules/hr/hr.export";

/**
 * `GET /api/hr/export?type=employees` (PRD #16 §146; AUD-08 §7).
 *
 * Filters arrive as ordinary search parameters, so the file is the list the
 * reader is looking at — same scope, same permissions, same filters, every
 * page (PRD #16 §147). An unknown `type` or filter is refused rather than
 * guessed, and past 1,000 rows the request is refused whole with a JSON error,
 * never a shortened file. It goes through `withContext` like every other
 * endpoint, so the guard sequence is not something this route remembers to do.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const type = exportSelector(params, "type", EXPORT_TYPES, "employees");
    const prepared = await exportHr(context, type, params);
    await recordExport(context, { id: "hr", module: "hr", filename: prepared.filename });
    return exportResponse(prepared);
  });
}
