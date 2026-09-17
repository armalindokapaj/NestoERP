import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createUnitContractSchema } from "@/lib/modules/contracts/units/unit-contract.schema";
import { createUnitContract, listUnitContracts } from "@/lib/modules/contracts/units/unit-contract.service";

type Params = { params: Promise<{ unitId: string }> };

/** GET — every contract the unit has had, its live one first (E-05F §57). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await listUnitContracts(context, unitId) }));
}

/** POST — Legal drafts the sale contract from Sales' open request, with more units of the same client and deal if chosen (E-05F §12, §74, §88). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = createUnitContractSchema.parse(await readJson(request));
    return apiOk({ data: await createUnitContract(context, unitId, input) }, { status: 201 });
  });
}
