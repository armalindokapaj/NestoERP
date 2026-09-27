import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { getProject3DModelStatuses } from "@/lib/modules/project-3d/project-3d.ingestion";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const response = apiOk({ data: await getProject3DModelStatuses(context, projectId) });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
