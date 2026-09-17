import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { deleteBuilding, updateBuilding } from "@/lib/modules/project-structure/structure.buildings";
import { updateBuildingSchema } from "@/lib/modules/project-structure/structure.schema";

type Params = { params: Promise<{ buildingId: string }> };

/** PATCH — rename, recode, describe or deactivate, with the version the form loaded (E-05B §54, §61, §95). */
export async function PATCH(request: Request, { params }: Params) {
  const { buildingId } = await params;
  return withContext(async (context) => {
    const input = updateBuildingSchema.parse(await readJson(request));
    return apiOk({ data: await updateBuilding(context, buildingId, input) });
  });
}

/** DELETE — only a building with no floors (E-05B §57). */
export async function DELETE(_request: Request, { params }: Params) {
  const { buildingId } = await params;
  return withContext(async (context) => {
    await deleteBuilding(context, buildingId);
    return apiOk({ data: { deleted: true } });
  });
}
