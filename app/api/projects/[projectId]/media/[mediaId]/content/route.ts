import { withContext } from "@/lib/api/respond";
import { projectMediaContentGrant } from "@/lib/modules/project-media/project-media.service";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string; mediaId: string }> }) {
  const { projectId, mediaId } = await params;
  return withContext(async (context) => {
    const grant = await projectMediaContentGrant(context, projectId, mediaId);
    return Response.redirect(new URL(grant.url, request.url), 307);
  });
}
