import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { getProject3DPlatformViewerBootstrap } from "@/lib/modules/project-3d/project-3d.viewer";

/** The published release as the Company viewer shows it, for Platform Admin. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    return apiOk({ data: await getProject3DPlatformViewerBootstrap(context, projectId) });
  });
}
