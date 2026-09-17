import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { versionedActionSchema } from "@/lib/modules/project-structure/unit-publishing.schema";
import { archiveUnit } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — take the unit out of every normal workflow, keeping its id, page and history (E-05D §32). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = versionedActionSchema.parse(await readJson(request));
    return apiOk({ data: await archiveUnit(context, unitId, input) });
  });
}
