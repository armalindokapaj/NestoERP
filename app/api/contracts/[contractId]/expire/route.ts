import { apiOk, withContext } from "@/lib/api/respond";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** ACTIVE → EXPIRED, once the end date has actually passed (PRD #18 §122). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.expireContract(context, contractId);
    return apiOk({ data: { ok: true } });
  });
}
