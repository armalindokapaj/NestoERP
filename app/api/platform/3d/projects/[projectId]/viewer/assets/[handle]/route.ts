import { withPlatformContext } from "@/lib/api/respond";
import { deliverProject3DAsset } from "@/lib/modules/project-3d/project-3d.delivery";

type Params = { params: Promise<{ projectId: string; handle: string }> };

/** The Platform company-viewer's model bytes: a Platform session only, and only the active release. */
async function deliver(request: Request, { params }: Params) {
  return withPlatformContext(async (context) => {
    const { projectId, handle } = await params;
    return deliverProject3DAsset(request, handle, { audience: "platform", context, projectId });
  });
}

export const GET = deliver;
export const HEAD = deliver;
