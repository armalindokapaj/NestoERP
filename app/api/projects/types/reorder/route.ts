import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderProjectTypesSchema } from "@/lib/modules/projects/project.schema";
import { reorderProjectTypes } from "@/lib/modules/projects/project-type.service";

/**
 * POST /api/projects/types/reorder — the order every project form offers the
 * company's types in (E-05A §62). The body names every type, once.
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const { ids } = reorderProjectTypesSchema.parse(await readJson(request));
    return apiOk({ data: await reorderProjectTypes(context, ids) });
  });
}
