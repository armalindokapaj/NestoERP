import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { deleteProject3DExperience } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { project3DDeleteSchema, project3DExperienceMetadataSchema } from "@/lib/modules/project-3d/project-3d.schema";
import { updateProject3DExperienceMetadata } from "@/lib/modules/project-3d/project-3d.service";

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DExperienceMetadataSchema.parse(await readJson(request));
    return apiOk({ data: await updateProject3DExperienceMetadata(context, projectId, input) });
  });
}

/** Delete 3D experience (ADM-04A §9): soft, restorable, never the ERP Project. */
export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DDeleteSchema.parse(await readJson(request));
    return apiOk({ data: await deleteProject3DExperience(context, projectId, input) });
  });
}
