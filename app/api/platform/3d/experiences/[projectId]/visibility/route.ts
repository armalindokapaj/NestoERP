import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { setProject3DVisibility } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { project3DVisibilitySchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Offline / Public / Company login only (ADM-04A §6). */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DVisibilitySchema.parse(await readJson(request));
    return apiOk({ data: await setProject3DVisibility(context, projectId, input) });
  });
}
