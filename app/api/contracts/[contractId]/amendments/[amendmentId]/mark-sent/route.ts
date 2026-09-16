import { apiOk, withContext } from "@/lib/api/respond";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

/** APPROVED → SENT (PRD #18 §172). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, amendmentId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    await amendments.markAmendmentSent(context, amendmentId);
    return apiOk({ data: { ok: true } });
  });
}
