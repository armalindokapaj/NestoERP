import { getPublic3DStatus } from "@/lib/modules/project-3d/project-3d.public";
import { publicJson, withPublic3D } from "@/lib/modules/project-3d/public/public-http";

export const dynamic = "force-dynamic";

/** What an open anonymous viewer polls every 15 seconds and on focus (ADM-04A §8). */
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  return withPublic3D(request, "PUBLIC_3D", async () => {
    const { publicId } = await params;
    return publicJson(await getPublic3DStatus(publicId));
  });
}
