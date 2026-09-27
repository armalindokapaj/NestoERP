import { apiOk, readOptionalJson, withPlatformContext } from "@/lib/api/respond";
import { retryProject3DModelProcessing } from "@/lib/modules/project-3d/project-3d.ingestion";
import { prepareProject3DModelAfterResponse } from "@/lib/modules/project-3d/project-3d.process-after";
import { project3DUploadCompleteSchema } from "@/lib/modules/project-3d/project-3d.schema";

export const maxDuration = 300;

/** Puts a model whose preparation stalled back in line (a cut request, a crashed worker). */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, versionId } = await params;
    const { reason } = project3DUploadCompleteSchema.parse(await readOptionalJson(request));
    const retried = await retryProject3DModelProcessing(context, projectId, versionId, reason);
    const preparedBy = await prepareProject3DModelAfterResponse(retried.id);
    return apiOk({ data: { ...retried, preparedBy } });
  });
}
