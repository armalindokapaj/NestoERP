import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { dealUnitSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { addUnitToDeal, listDealUnits } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ opportunityId: string }> };

/** GET — the units in this deal the reader may open (E-05E §17). */
export async function GET(_request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => apiOk({ data: await listDealUnits(context, opportunityId) }));
}

/** POST — add a unit to the deal without reserving it (E-05E §17, §43). */
export async function POST(request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    const input = dealUnitSchema.parse(await readJson(request));
    await addUnitToDeal(context, opportunityId, input);
    return apiOk({ data: { linked: true } }, { status: 201 });
  });
}
