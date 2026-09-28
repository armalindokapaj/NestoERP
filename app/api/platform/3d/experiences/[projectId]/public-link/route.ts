import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { rotateProject3DPublicLink } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { project3DRestoreSchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Replaces the public share address; the old one stops answering (ADM-04A §8). */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DRestoreSchema.parse(await readJson(request));
    return apiOk({ data: await rotateProject3DPublicLink(context, projectId, input) });
  });
}
