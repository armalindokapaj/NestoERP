import { apiOk, withContext } from "@/lib/api/respond";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** ACTIVE → COMPLETED; a sale contract only once it is financially complete (E-05F §83). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.completeContract(context, contractId);
    return apiOk({ data: { ok: true } });
  });
}
