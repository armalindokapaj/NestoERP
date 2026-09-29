import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { prisma } from "@/lib/database/prisma";
import { setProject3DVisibility } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { ensureProject3DPublicRelease } from "@/lib/modules/project-3d/project-3d.public";
import { project3DVisibilitySchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Offline / Public / Company login only (ADM-04A §6). */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DVisibilitySchema.parse(await readJson(request));
    // Public needs no separate approval: the live release's public version is prepared and approved here.
    if (input.visibility === "PUBLIC") {
      const config = await prisma.project3DConfig.findFirst({ where: { projectId, deletedAt: null }, select: { activeReleaseId: true } });
      if (config?.activeReleaseId) {
        input.publicManifestHash = await ensureProject3DPublicRelease(context, projectId, config.activeReleaseId);
        input.releaseId = config.activeReleaseId;
      }
    }
    return apiOk({ data: await setProject3DVisibility(context, projectId, input) });
  });
}
