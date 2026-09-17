import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderFloors } from "@/lib/modules/project-structure/structure.floors";
import { reorderSchema } from "@/lib/modules/project-structure/structure.schema";

type Params = { params: Promise<{ buildingId: string }> };

/** POST — the order of the building's floors; the body names every floor once (E-05B §15). */
export async function POST(request: Request, { params }: Params) {
  const { buildingId } = await params;
  return withContext(async (context) => {
    const { ids } = reorderSchema.parse(await readJson(request));
    await reorderFloors(context, buildingId, ids);
    return apiOk({ data: { reordered: true } });
  });
}
