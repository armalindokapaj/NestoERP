import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { setUnitSalesPlan } from "@/lib/modules/project-structure/unit-files.service";
import { salesPlanSchema } from "@/lib/modules/project-structure/unit-publishing.schema";

type Params = { params: Promise<{ unitId: string }> };

/** POST — make a PDF uploaded to the unit its one Sales Plan, or record a new version of it (E-05D §33-§36, §78). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = salesPlanSchema.parse(await readJson(request));
    return apiOk({ data: await setUnitSalesPlan(context, unitId, input) });
  });
}
