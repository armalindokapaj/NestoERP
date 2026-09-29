import { apiOk, readOptionalJson, withPlatformContext } from "@/lib/api/respond";
import { prisma } from "@/lib/database/prisma";
import { ensureProject3DPublicRelease } from "@/lib/modules/project-3d/project-3d.public";
import { activateProject3DRelease } from "@/lib/modules/project-3d/project-3d.release";
import { project3DReleaseActivateSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; releaseId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, releaseId } = await params;
    const { reason } = project3DReleaseActivateSchema.parse(await readOptionalJson(request));
    const config = await prisma.project3DConfig.findFirst({ where: { projectId, deletedAt: null }, select: { visibility: true } });
    // Restoring an older release while Public gives it a public version first.
    if (config?.visibility === "PUBLIC") await ensureProject3DPublicRelease(context, projectId, releaseId);
    return apiOk({ data: await activateProject3DRelease(context, projectId, releaseId, reason) });
  });
}
