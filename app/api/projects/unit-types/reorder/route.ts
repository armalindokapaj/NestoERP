import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderSchema } from "@/lib/modules/project-structure/structure.schema";
import { reorderUnitTypes } from "@/lib/modules/project-structure/unit-type.service";

/** POST /api/projects/unit-types/reorder — the order unit forms offer the company's types in; the body names every type once. */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const { ids } = reorderSchema.parse(await readJson(request));
    return apiOk({ data: await reorderUnitTypes(context, ids) });
  });
}
