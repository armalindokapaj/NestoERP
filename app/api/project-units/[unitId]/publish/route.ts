import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { publishSchema } from "@/lib/modules/project-structure/unit-publishing.schema";
import { publishUnit } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — publish the next immutable version of the unit, after validating it again under a lock (E-05D §17, §23, §66, §82). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = publishSchema.parse(await readJson(request));
    return apiOk({ data: await publishUnit(context, unitId, input) });
  });
}
