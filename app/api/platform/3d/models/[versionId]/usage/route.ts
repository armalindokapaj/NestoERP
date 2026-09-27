import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { getProject3DModelVersionUsage } from "@/lib/modules/project-3d/project-3d.model-library";

/** Where a Model Library version is still used, read before offering to delete it. */
export async function GET(_request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { versionId } = await params;
    const response = apiOk({ data: await getProject3DModelVersionUsage(context, versionId) });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
