import { apiOk, readOptionalJson, withPlatformContext } from "@/lib/api/respond";
import { deactivateProject3DModelSlot } from "@/lib/modules/project-3d/project-3d.ingestion";
import { project3DSlotRemoveSchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Removes a model from the Experience; its versions and any published release stay. */
export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string; slotId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, slotId } = await params;
    const { reason } = project3DSlotRemoveSchema.parse(await readOptionalJson(request));
    return apiOk({ data: await deactivateProject3DModelSlot(context, projectId, slotId, reason) });
  });
}
