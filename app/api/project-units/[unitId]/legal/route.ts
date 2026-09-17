import { apiOk, withContext } from "@/lib/api/respond";
import { getUnitLegal } from "@/lib/modules/contracts/units/unit-contract.service";

type Params = { params: Promise<{ unitId: string }> };

/** GET — the unit's contract, its history, Sales' requests and what the reader may do (E-05F §49, §57). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await getUnitLegal(context, unitId) }));
}
