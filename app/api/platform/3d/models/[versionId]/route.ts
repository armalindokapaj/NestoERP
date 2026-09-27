import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { deleteProject3DModelVersion } from "@/lib/modules/project-3d/project-3d.model-library";
import { project3DModelVersionDeleteSchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Deletes a model version and its files permanently; refused while anything still uses it. */
export async function DELETE(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { versionId } = await params;
    project3DModelVersionDeleteSchema.parse(await readJson(request));
    return apiOk({ data: await deleteProject3DModelVersion(context, versionId) });
  });
}
