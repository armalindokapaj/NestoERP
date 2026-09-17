import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderBuildings } from "@/lib/modules/project-structure/structure.buildings";
import { reorderSchema } from "@/lib/modules/project-structure/structure.schema";

type Params = { params: Promise<{ projectId: string }> };

/** POST — the order of the project's buildings; the body names every building once (E-05B §10). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const { ids } = reorderSchema.parse(await readJson(request));
    await reorderBuildings(context, projectId, ids);
    return apiOk({ data: { reordered: true } });
  });
}
