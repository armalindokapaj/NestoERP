import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractActivationSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** SIGNED → ACTIVE, never before the effective date (PRD #18 §120, §121). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const { effectiveDate } = contractActivationSchema.parse(await readJson(request));
    await contracts.activateContract(context, contractId, effectiveDate ?? null);
    return apiOk({ data: { ok: true } });
  });
}
