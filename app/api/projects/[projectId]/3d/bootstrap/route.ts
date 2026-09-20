import { apiOk, withContext } from "@/lib/api/respond";
import { getProject3DViewerBootstrap } from "@/lib/modules/project-3d/project-3d.viewer";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  return withContext(async (context) => {
    const { projectId } = await params;
    return apiOk({ data: await getProject3DViewerBootstrap(context, projectId) });
  });
}
