import { apiOk, readJson, readOptionalJson, withPlatformContext } from "@/lib/api/respond";
import { deactivateProject3DModelSlot, updateProject3DModelSlot } from "@/lib/modules/project-3d/project-3d.ingestion";
import { project3DSlotRemoveSchema, project3DSlotUpdateSchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Removes a model from the Experience; its versions and any published release stay. */
export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string; slotId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, slotId } = await params;
    const { reason } = project3DSlotRemoveSchema.parse(await readOptionalJson(request));
    return apiOk({ data: await deactivateProject3DModelSlot(context, projectId, slotId, reason) });
  });
}

/** Renames a model, or sets the model its transform follows (Building Anchor). */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; slotId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, slotId } = await params;
    const input = project3DSlotUpdateSchema.parse(await readJson(request));
    return apiOk({ data: await updateProject3DModelSlot(context, projectId, slotId, input) });
  });
}
