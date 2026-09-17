import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderSchema } from "@/lib/modules/project-structure/structure.schema";
import { reorderUnitMedia } from "@/lib/modules/project-structure/unit-files.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — the order of the unit's images; the body names every image once (E-05D §43). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const { ids } = reorderSchema.parse(await readJson(request));
    await reorderUnitMedia(context, unitId, ids);
    return apiOk({ data: { reordered: true } });
  });
}
