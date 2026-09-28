import { apiOk, withContext } from "@/lib/api/respond";
import { getProject3DViewerStatus } from "@/lib/modules/project-3d/project-3d.viewer";

/** What an open company viewer polls (ADM-04A §8): still allowed, and still the same release? */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withContext(async (context) => {
    const { projectId } = await params;
    const response = apiOk({ data: await getProject3DViewerStatus(context, projectId) });
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  });
}
