import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { getProject3DPlatformViewerStatus } from "@/lib/modules/project-3d/project-3d.viewer";

/** What the open Platform company viewer polls: still published, and still the same release? */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const response = apiOk({ data: await getProject3DPlatformViewerStatus(context, projectId) });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  });
}
