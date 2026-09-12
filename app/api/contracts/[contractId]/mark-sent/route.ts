import { apiOk, withContext } from "@/lib/api/respond";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** APPROVED → SENT (PRD #18 §117). No email is sent; this records that one was. */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.markSent(context, contractId);
    return apiOk({ data: { ok: true } });
  });
}
