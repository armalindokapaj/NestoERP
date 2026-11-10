import { withContext } from "@/lib/api/respond";
import { getRequestLocale } from "@/lib/i18n/server";
import { parseUnitListQuery } from "@/lib/modules/project-structure/structure.schema";
import { parseInventoryQuery } from "@/lib/modules/sales/units/unit-sales.schema";
import { buildSheetDownload, type UnitExportScope } from "@/lib/modules/unit-sheet/unit-sheet.service";
import { XLSX_CONTENT_TYPE } from "@/lib/modules/unit-sheet/unit-sheet.xlsx";

type Params = { params: Promise<{ projectId: string }> };

/**
 * The tab's own query as Export sends it (2026-11-10): `view=units` with the
 * Units list's filters (its building or floor choice too), or `view=sales`
 * with the Sales list's. Anything else is the whole project.
 */
function exportScope(search: URLSearchParams): UnitExportScope | undefined {
  const view = search.get("view");
  if (view === "units") {
    const query = parseUnitListQuery(search);
    // The Units tab no longer offers the internal-area range; an old link exports what its panel says, as the page shows it.
    return { view, query: { ...query, internalAreaMin: undefined, internalAreaMax: undefined } };
  }
  if (view === "sales") return { view, query: parseInventoryQuery(search) };
  return undefined;
}

/** `filename*` for a name with letters outside ASCII (RFC 6266, RFC 5987). */
function encodeExtended(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * GET — "Download for Google Sheets" (2026-11-10): the project's units in
 * use as an .xlsx file, header in the reader's language, for File → Import →
 * Upload → Replace current sheet. Also "Start from NESTO's units". Anyone who
 * can open the Units tab; never cached.
 *
 * With `view=units` or `view=sales` and that tab's search and filters, the
 * tab's Export: the same builder and columns, narrowed to the units the tab
 * matches, plus a Status column for a reader who may see sales.
 */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const search = new URL(request.url).searchParams;
  return withContext(async (context) => {
    const file = await buildSheetDownload(context, projectId, await getRequestLocale(), exportScope(search));
    // Both names are made of safe characters only (`sheetFilename`, `exportFilename`): nothing needs quoting.
    const disposition = file.filenameUtf8 === file.filename ? `attachment; filename="${file.filename}"` : `attachment; filename="${file.filename}"; filename*=UTF-8''${encodeExtended(file.filenameUtf8)}`;
    return new Response(Buffer.from(file.body), {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": disposition,
        "Content-Length": String(file.body.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Row-Count": String(file.rows),
      },
    });
  });
}
