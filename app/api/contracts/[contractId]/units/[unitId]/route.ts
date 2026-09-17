import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractUnitValueSchema } from "@/lib/modules/contracts/units/unit-contract.schema";
import { updateContractUnitValue } from "@/lib/modules/contracts/units/unit-contract.service";

type Params = { params: Promise<{ contractId: string; unitId: string }> };

/** PATCH — a unit's part of a draft sale contract's value; the contract value stays the sum (E-05F §14, §90). */
export async function PATCH(request: Request, { params }: Params) {
  const { contractId, unitId } = await params;
  return withContext(async (context) => {
    const input = contractUnitValueSchema.parse(await readJson(request));
    return apiOk({ data: await updateContractUnitValue(context, contractId, unitId, input) });
  });
}
