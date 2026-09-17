import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { markSoldSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { markUnitSold } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — mark a reserved unit Sold; the reservation converts to the sale (E-05E §29, §42). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = markSoldSchema.parse(await readJson(request));
    return apiOk({ data: await markUnitSold(context, unitId, input) });
  });
}
