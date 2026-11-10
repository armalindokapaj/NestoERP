import { withContext } from "@/lib/api/respond";
import { getRequestLocale } from "@/lib/i18n/server";
import { buildSheetDownload } from "@/lib/modules/unit-sheet/unit-sheet.service";
import { XLSX_CONTENT_TYPE } from "@/lib/modules/unit-sheet/unit-sheet.xlsx";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET — "Download for Google Sheets" (2026-11-10): the project's units in
 * use as an .xlsx file, header in the reader's language, for File → Import →
 * Upload → Replace current sheet. Also "Start from NESTO's units". Anyone who
 * can open the Units tab; never cached.
 */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const file = await buildSheetDownload(context, projectId, await getRequestLocale());
    return new Response(Buffer.from(file.body), {
      status: 200,
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        // `sheetFilename` leaves nothing that needs quoting or a `filename*`.
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Content-Length": String(file.body.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Row-Count": String(file.rows),
      },
    });
  });
}
