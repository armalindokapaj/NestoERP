import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateUnitTypeSchema } from "@/lib/modules/project-structure/structure.schema";
import { deleteUnitType, updateUnitType } from "@/lib/modules/project-structure/unit-type.service";

type Params = { params: Promise<{ unitTypeId: string }> };

/**
 * PATCH  /api/projects/unit-types/:unitTypeId — rename, recode, recategorise, retire or bring back (E-05B §116).
 * DELETE /api/projects/unit-types/:unitTypeId — only a type no unit uses.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { unitTypeId } = await params;
  return withContext(async (context) => {
    const input = updateUnitTypeSchema.parse(await readJson(request));
    return apiOk({ data: await updateUnitType(context, unitTypeId, input) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { unitTypeId } = await params;
  return withContext(async (context) => {
    await deleteUnitType(context, unitTypeId);
    return apiOk({ data: { deleted: true } });
  });
}
