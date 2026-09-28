import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { getProject3DPublicPreview, prepareProject3DPublicProjection } from "@/lib/modules/project-3d/project-3d.public";
import { project3DPublicPrepareSchema } from "@/lib/modules/project-3d/project-3d.schema";

type Params = { params: Promise<{ projectId: string; releaseId: string }> };

/** The public preview of a release's projection: exactly what a visitor would receive (ADM-04A §6). */
export async function GET(_request: Request, { params }: Params) {
  return withPlatformContext(async (context) => {
    const { projectId, releaseId } = await params;
    return apiOk({ data: await getProject3DPublicPreview(context, projectId, releaseId) });
  });
}

/** Prepares (or re-prepares) a release's public projection; it stays unapproved (ADM-04A §5). */
export async function POST(request: Request, { params }: Params) {
  return withPlatformContext(async (context) => {
    const { projectId, releaseId } = await params;
    const input = project3DPublicPrepareSchema.parse(await readJson(request));
    return apiOk({ data: await prepareProject3DPublicProjection(context, projectId, { ...input, releaseId }) });
  });
}
