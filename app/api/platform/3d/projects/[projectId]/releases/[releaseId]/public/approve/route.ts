import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { approveProject3DPublicProjection } from "@/lib/modules/project-3d/project-3d.public";
import { project3DPublicApproveSchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Approves exactly the previewed projection for public distribution (ADM-04A §6). */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; releaseId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, releaseId } = await params;
    const input = project3DPublicApproveSchema.parse(await readJson(request));
    return apiOk({ data: await approveProject3DPublicProjection(context, projectId, { ...input, releaseId }) });
  });
}
