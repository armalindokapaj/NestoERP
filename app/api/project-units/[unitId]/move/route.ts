import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { moveUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { moveUnit } from "@/lib/modules/project-structure/structure.units";

type Params = { params: Promise<{ unitId: string }> };

/** POST — another floor of the same project; the unit keeps its id, code and page (E-05B §52, §64, §118). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = moveUnitSchema.parse(await readJson(request));
    return apiOk({ data: await moveUnit(context, unitId, input) });
  });
}
