import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { removeUnitMedia, updateUnitMedia } from "@/lib/modules/project-structure/unit-files.service";
import { updateMediaSchema } from "@/lib/modules/project-structure/unit-publishing.schema";

type Params = { params: Promise<{ unitId: string; mediaId: string }> };

/** PATCH — an image's category or caption, or make it the primary image (E-05D §41, §42, §76). */
export async function PATCH(request: Request, { params }: Params) {
  const { unitId, mediaId } = await params;
  return withContext(async (context) => {
    const input = updateMediaSchema.parse(await readJson(request));
    await updateUnitMedia(context, unitId, mediaId, input);
    return apiOk({ data: { updated: true } });
  });
}

/** DELETE — the unit stops showing the image; the file stays in Documents (E-05D §44). */
export async function DELETE(_request: Request, { params }: Params) {
  const { unitId, mediaId } = await params;
  return withContext(async (context) => {
    await removeUnitMedia(context, unitId, mediaId);
    return apiOk({ data: { removed: true } });
  });
}
