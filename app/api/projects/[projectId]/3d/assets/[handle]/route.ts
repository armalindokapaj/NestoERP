import { withContext } from "@/lib/api/respond";
import { deliverProject3DAsset } from "@/lib/modules/project-3d/project-3d.delivery";

type Params = { params: Promise<{ projectId: string; handle: string }> };

/**
 * A company viewer's model bytes (ADM-04A §8): streamed after the handle, the
 * reader's project access and the experience's audience are checked again.
 */
async function deliver(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { projectId, handle } = await params;
    return deliverProject3DAsset(request, handle, { audience: "company", context, projectId });
  });
}

export const GET = deliver;
export const HEAD = deliver;
