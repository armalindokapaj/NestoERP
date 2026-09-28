import { getPublic3DBootstrap } from "@/lib/modules/project-3d/project-3d.public";
import { publicJson, withPublic3D } from "@/lib/modules/project-3d/public/public-http";

export const dynamic = "force-dynamic";

/**
 * The anonymous viewer's bootstrap (ADM-04A §7). Read-only, no session, no
 * membership; only an approved public projection, with gated asset handles.
 * Company-only and unavailable experiences answer with their state alone.
 */
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  return withPublic3D(request, "PUBLIC_3D", async () => {
    const { publicId } = await params;
    const result = await getPublic3DBootstrap(publicId);
    return result.state === "AVAILABLE" ? publicJson({ state: "AVAILABLE", bootstrap: result.bootstrap }) : publicJson({ state: result.state }, 404);
  });
}
