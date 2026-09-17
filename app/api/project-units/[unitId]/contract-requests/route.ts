import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { requestContractSchema } from "@/lib/modules/contracts/units/unit-contract.schema";
import { requestUnitContract } from "@/lib/modules/contracts/units/unit-contract.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — Sales asks Legal for the unit's contract; it waits in Legal's queue (E-05F §12). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = requestContractSchema.parse(await readJson(request));
    return apiOk({ data: await requestUnitContract(context, unitId, input) }, { status: 201 });
  });
}
