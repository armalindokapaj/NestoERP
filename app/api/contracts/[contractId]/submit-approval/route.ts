import { apiOk, withContext } from "@/lib/api/respond";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** IN_REVIEW → PENDING_APPROVAL, opening an approval cycle (PRD #18 §111). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.submitForApproval(context, contractId);
    return apiOk({ data: { ok: true } });
  });
}
