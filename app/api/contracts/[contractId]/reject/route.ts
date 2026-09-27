import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractReasonSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ contractId: string }> };

/**
 * PENDING_APPROVAL → IN_REVIEW, with a required reason (PRD #18 §114, §190).
 *
 * "Rejected" on its own tells whoever drafted it nothing they can act on.
 */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request);
    const { note } = contractReasonSchema.parse(body);
    await contracts.rejectContract(context, contractId, note, approvalGuardFrom(body));
    return apiOk({ data: { ok: true } });
  });
}
