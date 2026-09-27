import { apiOk, readOptionalJson, withPlatformContext } from "@/lib/api/respond";
import { completeProject3DModelUpload } from "@/lib/modules/project-3d/project-3d.ingestion";
import { prepareProject3DModelAfterResponse } from "@/lib/modules/project-3d/project-3d.process-after";
import { project3DUploadCompleteSchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Where no worker runs, the verified model is prepared after this response, within this limit. */
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, versionId } = await params;
    const { reason } = project3DUploadCompleteSchema.parse(await readOptionalJson(request));
    const completed = await completeProject3DModelUpload(context, projectId, versionId, reason);
    const preparedBy = completed.status === "PROCESSING" ? await prepareProject3DModelAfterResponse(completed.id) : null;
    return apiOk({ data: { ...completed, preparedBy } });
  });
}
