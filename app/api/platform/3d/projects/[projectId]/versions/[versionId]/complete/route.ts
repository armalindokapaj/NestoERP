import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { completeProject3DModelUpload } from "@/lib/modules/project-3d/project-3d.ingestion";
import { project3DUploadCompleteSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, versionId } = await params;
    const { reason } = project3DUploadCompleteSchema.parse(await readJson(request));
    return apiOk({ data: await completeProject3DModelUpload(context, projectId, versionId, reason) });
  });
}
