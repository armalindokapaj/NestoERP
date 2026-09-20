import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { activateProject3DRelease } from "@/lib/modules/project-3d/project-3d.release";
import { project3DReleaseActivateSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; releaseId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, releaseId } = await params;
    const { reason } = project3DReleaseActivateSchema.parse(await readJson(request));
    return apiOk({ data: await activateProject3DRelease(context, projectId, releaseId, reason) });
  });
}
