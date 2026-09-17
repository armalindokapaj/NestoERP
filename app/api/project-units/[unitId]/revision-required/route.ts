import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { revisionSchema } from "@/lib/modules/project-structure/unit-publishing.schema";
import { requestUnitRevision } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — send the unit, or its waiting changes, back for revision with a reason (E-05D §22, §67). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = revisionSchema.parse(await readJson(request));
    return apiOk({ data: await requestUnitRevision(context, unitId, input) });
  });
}
