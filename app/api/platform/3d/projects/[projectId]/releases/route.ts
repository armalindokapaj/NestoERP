import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { ensureProject3DPublicRelease } from "@/lib/modules/project-3d/project-3d.public";
import { listProject3DReleases, publishProject3DRelease } from "@/lib/modules/project-3d/project-3d.release";
import { project3DReleasePublishSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    return apiOk({ data: await listProject3DReleases(context, projectId) });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DReleasePublishSchema.parse(await readJson(request));
    const release = await publishProject3DRelease(context, projectId, input);
    // While Public, a new release goes live at once: its public version is prepared and approved now.
    if (release.needsPublicReview) {
      await ensureProject3DPublicRelease(context, projectId, release.id);
      return apiOk({ data: { ...release, active: true, needsPublicReview: false } }, { status: 201 });
    }
    return apiOk({ data: release }, { status: 201 });
  });
}
