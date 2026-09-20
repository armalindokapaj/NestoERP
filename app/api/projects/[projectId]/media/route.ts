import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createProjectMediaSchema } from "@/lib/modules/project-media/project-media.schema";
import { addProjectMedia, listProjectMedia } from "@/lib/modules/project-media/project-media.service";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await listProjectMedia(context, projectId) }));
}

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = createProjectMediaSchema.parse(await readJson(request));
    return apiOk({ data: await addProjectMedia(context, projectId, input) }, { status: 201 });
  });
}
