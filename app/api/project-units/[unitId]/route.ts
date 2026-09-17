import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { getUnitDetail } from "@/lib/modules/project-structure/structure.service";
import { deleteUnit, updateUnit } from "@/lib/modules/project-structure/structure.units";

type Params = { params: Promise<{ unitId: string }> };

/** GET — the one canonical unit, with its building, floor and what the reader may do (E-05B §29, §63). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await getUnitDetail(context, unitId) }));
}

/** PATCH — the unit's code and technical data, with the version the form loaded; the id never changes (E-05B §55, §83, §95). */
export async function PATCH(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = updateUnitSchema.parse(await readJson(request));
    return apiOk({ data: await updateUnit(context, unitId, input) });
  });
}

/** DELETE — remove the unit (E-05B §56). */
export async function DELETE(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    await deleteUnit(context, unitId);
    return apiOk({ data: { deleted: true } });
  });
}
