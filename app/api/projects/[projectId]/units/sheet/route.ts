import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { sheetLinkSchema } from "@/lib/modules/unit-sheet/unit-sheet.schema";
import { getSheetStatus, linkSheet, unlinkSheet } from "@/lib/modules/unit-sheet/unit-sheet.service";

type Params = { params: Promise<{ projectId: string }> };

/** Reading the sheet takes up to ten seconds of Google's time. */
export const maxDuration = 60;

/**
 * The project's Units linked to a Google Sheet (2026-11-10).
 *
 * GET — `{ data: { link, capabilities } }`: the link (null when there is
 * none), who linked it and when, the last sync and by whom, and what the
 * reader may do. Anyone who can open the Units tab.
 *
 * PUT — `{ url, dryRun? }`: reads the sheet, then links it (or replaces the
 * link); `dryRun` only reads. Answers `{ data: { link, check } }`, `check`
 * being the rows and columns found. `project.unit.update`.
 *
 * DELETE — unlinks; the units stay as they are. `project.unit.update`.
 */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await getSheetStatus(context, projectId) }));
}

export async function PUT(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = sheetLinkSchema.parse(await readJson(request));
    return apiOk({ data: await linkSheet(context, projectId, input) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    await unlinkSheet(context, projectId);
    return apiOk({ data: { unlinked: true } });
  });
}
