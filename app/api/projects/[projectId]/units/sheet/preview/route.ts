import { apiOk, withContext } from "@/lib/api/respond";
import { previewSheetSync } from "@/lib/modules/unit-sheet/unit-sheet.service";

type Params = { params: Promise<{ projectId: string }> };

/** Reading the sheet takes up to ten seconds of Google's time; comparing it, a moment more. */
export const maxDuration = 60;

/**
 * POST — Sync now (2026-11-10): reads the linked sheet and answers every
 * change it would make — changes from the sheet, clashes, new units, what is
 * newer in NESTO, rows skipped and why, units not in the sheet, unknown
 * columns — with the `sheetHash` and `linkVersion` a confirm sends back.
 * Writes nothing. `project.unit.update`.
 */
export async function POST(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await previewSheetSync(context, projectId) }));
}
