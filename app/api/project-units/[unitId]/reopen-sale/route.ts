import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reopenSaleSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { reopenSale } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — reopen a sold unit, back to For Sale or Reserved, with a reason; elevated (E-05E §31). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = reopenSaleSchema.parse(await readJson(request));
    return apiOk({ data: await reopenSale(context, unitId, input) });
  });
}
