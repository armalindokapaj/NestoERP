import { apiOk, withContext } from "@/lib/api/respond";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** DRAFT → IN_REVIEW (PRD #18 §108). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.submitForReview(context, contractId);
    return apiOk({ data: { ok: true } });
  });
}
