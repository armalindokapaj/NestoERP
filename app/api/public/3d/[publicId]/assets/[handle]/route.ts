import { deliverProject3DAsset } from "@/lib/modules/project-3d/project-3d.delivery";
import { withPublic3D } from "@/lib/modules/project-3d/public/public-http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ publicId: string; handle: string }> };

/** Public model and cover bytes, re-authorized on every GET, HEAD and Range request (ADM-04A §8). */
async function deliver(request: Request, { params }: Params) {
  return withPublic3D(request, "PUBLIC_3D_ASSET", async () => {
    const { publicId, handle } = await params;
    return deliverProject3DAsset(request, handle, { audience: "public", publicId });
  });
}

export const GET = deliver;
export const HEAD = deliver;
