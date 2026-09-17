import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { commercialDetailsSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { getUnitSales, updateCommercialDetails } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ unitId: string }> };

/** GET — the unit's commercial side: status, price, reservations, history, what the reader may do (E-05E §15, §45). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await getUnitSales(context, unitId) }));
}

/** PATCH — asking price, currency, price basis and sales notes; a price change keeps its history (E-05E §10-§12). */
export async function PATCH(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = commercialDetailsSchema.parse(await readJson(request));
    return apiOk({ data: await updateCommercialDetails(context, unitId, input) });
  });
}
