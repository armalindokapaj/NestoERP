import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { createProject3DModelUpload } from "@/lib/modules/project-3d/project-3d.ingestion";
import { project3DUploadCreateSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; slotId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, slotId } = await params;
    const input = project3DUploadCreateSchema.parse(await readJson(request));
    return apiOk({ data: await createProject3DModelUpload(context, projectId, slotId, input) }, { status: 201 });
  });
}

