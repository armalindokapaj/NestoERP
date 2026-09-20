import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { getProject3DWorkspace } from "@/lib/modules/project-3d/project-3d.service";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    return apiOk({ data: await getProject3DWorkspace(context, projectId) });
  });
}

