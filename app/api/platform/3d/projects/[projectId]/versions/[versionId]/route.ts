import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { updateProject3DModelSettings } from "@/lib/modules/project-3d/project-3d.editor";
import { project3DModelSettingsUpdateSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, versionId } = await params;
    const input = project3DModelSettingsUpdateSchema.parse(await readJson(request));
    return apiOk({ data: await updateProject3DModelSettings(context, projectId, versionId, input) });
  });
}
