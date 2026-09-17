import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { deleteFloor, updateFloor } from "@/lib/modules/project-structure/structure.floors";
import { updateFloorSchema } from "@/lib/modules/project-structure/structure.schema";

type Params = { params: Promise<{ floorId: string }> };

/** PATCH — the floor's number, name, level, elevation or state, with the version the form loaded (E-05B §62, §95). */
export async function PATCH(request: Request, { params }: Params) {
  const { floorId } = await params;
  return withContext(async (context) => {
    const input = updateFloorSchema.parse(await readJson(request));
    return apiOk({ data: await updateFloor(context, floorId, input) });
  });
}

/** DELETE — only a floor with no units (E-05B §57). */
export async function DELETE(_request: Request, { params }: Params) {
  const { floorId } = await params;
  return withContext(async (context) => {
    await deleteFloor(context, floorId);
    return apiOk({ data: { deleted: true } });
  });
}
