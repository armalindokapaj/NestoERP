import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { saleStatusSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { changeSaleStatus } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — put on sale, take off sale, hold with a reason, or release the hold (E-05E §8, §28). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = saleStatusSchema.parse(await readJson(request));
    return apiOk({ data: await changeSaleStatus(context, unitId, input) });
  });
}
