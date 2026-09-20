import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderProjectMediaSchema } from "@/lib/modules/project-media/project-media.schema";
import { reorderProjectMedia } from "@/lib/modules/project-media/project-media.service";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const { ids } = reorderProjectMediaSchema.parse(await readJson(request));
    await reorderProjectMedia(context, projectId, ids);
    return apiOk({ data: { reordered: true } });
  });
}
