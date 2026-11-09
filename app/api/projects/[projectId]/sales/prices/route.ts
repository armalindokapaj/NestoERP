import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { priceListSaveSchema } from "@/lib/modules/sales/units/unit-pricing.schema";
import { getPriceList, savePriceList } from "@/lib/modules/sales/units/unit-pricing.service";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's price list: every active unit's asking price, building by building, floor by floor. */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await getPriceList(context, projectId) }));
}

/** PUT — many asking prices at once (a floor's rate, the parking price, single units); each keeps its history. */
export async function PUT(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = priceListSaveSchema.parse(await readJson(request));
    return apiOk({ data: await savePriceList(context, projectId, input) });
  });
}
