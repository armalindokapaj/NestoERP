import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { moveFloor } from "@/lib/modules/project-structure/structure.floors";
import { moveFloorSchema } from "@/lib/modules/project-structure/structure.schema";

type Params = { params: Promise<{ floorId: string }> };

/** POST — move the floor, and its units with it, to another building of the project (E-05B §53). */
export async function POST(request: Request, { params }: Params) {
  const { floorId } = await params;
  return withContext(async (context) => {
    const input = moveFloorSchema.parse(await readJson(request));
    return apiOk({ data: await moveFloor(context, floorId, input) });
  });
}
