import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { sheetApplySchema } from "@/lib/modules/unit-sheet/unit-sheet.schema";
import { applySheetSync } from "@/lib/modules/unit-sheet/unit-sheet.service";

type Params = { params: Promise<{ projectId: string }> };

/** A sheet of thousands of units, each changed in its own transactions: the most a function may run. */
export const maxDuration = 300;

/**
 * POST — confirms a preview (2026-11-10): `{ sheetHash, linkVersion, units:
 * [{ id, version, salesVersion }], accept: [ids], clashes: { id: "SHEET" |
 * "NESTO" }, putOnSale }`. The sheet is read again; a sheet changed since the
 * preview, or a sync somebody else confirmed since, is refused (409). Each
 * unit is changed by the service its own page uses, and a unit changed since
 * the preview is skipped. Answers `{ data: { applied, skipped, putOnSale,
 * link } }`. `project.unit.update`; prices also Sales' price grant; new
 * units `project.unit.create`.
 */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = sheetApplySchema.parse(await readJson(request));
    return apiOk({ data: await applySheetSync(context, projectId, input) });
  });
}
