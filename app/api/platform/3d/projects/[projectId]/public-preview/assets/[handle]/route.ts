import { withPlatformContext } from "@/lib/api/respond";
import { deliverProject3DAsset } from "@/lib/modules/project-3d/project-3d.delivery";

type Params = { params: Promise<{ projectId: string; handle: string }> };

/** Public-preview assets for a Platform session only; never for a deleted experience (ADM-04A §8). */
async function deliver(request: Request, { params }: Params) {
  return withPlatformContext(async (context) => {
    const { projectId, handle } = await params;
    return deliverProject3DAsset(request, handle, { audience: "preview", context, projectId });
  });
}

export const GET = deliver;
export const HEAD = deliver;
