import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderSchema } from "@/lib/modules/project-structure/structure.schema";
import { reorderUnits } from "@/lib/modules/project-structure/structure.units";

type Params = { params: Promise<{ floorId: string }> };

/** POST — the order of the floor's units; the body names every unit on it once (E-05B §51). */
export async function POST(request: Request, { params }: Params) {
  const { floorId } = await params;
  return withContext(async (context) => {
    const { ids } = reorderSchema.parse(await readJson(request));
    await reorderUnits(context, floorId, ids);
    return apiOk({ data: { reordered: true } });
  });
}
