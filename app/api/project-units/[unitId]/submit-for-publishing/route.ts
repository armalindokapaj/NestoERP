import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { versionedActionSchema } from "@/lib/modules/project-structure/unit-publishing.schema";
import { submitUnitForPublishing } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — ask for the unit, or its unpublished changes, to be reviewed; only a complete unit may ask (E-05D §16, §21, §65). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = versionedActionSchema.parse(await readJson(request));
    return apiOk({ data: await submitUnitForPublishing(context, unitId, input) });
  });
}
