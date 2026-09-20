import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
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
    return apiOk({ data: await publishProject3DRelease(context, projectId, input) }, { status: 201 });
  });
}
