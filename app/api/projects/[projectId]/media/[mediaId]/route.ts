import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateProjectMediaSchema } from "@/lib/modules/project-media/project-media.schema";
import { removeProjectMedia, updateProjectMedia } from "@/lib/modules/project-media/project-media.service";

type Params = { params: Promise<{ projectId: string; mediaId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { projectId, mediaId } = await params;
  return withContext(async (context) => {
    await updateProjectMedia(context, projectId, mediaId, updateProjectMediaSchema.parse(await readJson(request)));
    return apiOk({ data: { updated: true } });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { projectId, mediaId } = await params;
  return withContext(async (context) => {
    await removeProjectMedia(context, projectId, mediaId);
    return apiOk({ data: { removed: true } });
  });
}
