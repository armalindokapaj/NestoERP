import { withContext } from "@/lib/api/respond";
import { EXPORT_TYPES, exportHr, type HrExportType } from "@/lib/modules/hr/hr.export";

/**
 * `GET /api/hr/export?type=employees` (PRD #16 §146).
 *
 * Filters arrive as ordinary search parameters, so the file is the list the
 * reader is looking at — same scope, same permissions, same filters
 * (PRD #16 §147). It goes through `withContext` like every other endpoint, so
 * the guard sequence is not something this route remembers to do.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;

    const requested = params.get("type") ?? "employees";
    const type = (EXPORT_TYPES as readonly string[]).includes(requested)
      ? (requested as HrExportType)
      : "employees";

    const { filename, csv } = await exportHr(context, type, params);

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        // An export answers one reader's scope at one moment; it must never be
        // served to the next person from a shared cache.
        "cache-control": "private, no-store",
      },
    });
  });
}
