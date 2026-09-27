import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentReasonSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

/** PENDING_APPROVAL → REJECTED, with a required reason (PRD #18 §190). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, amendmentId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request);
    const { note } = amendmentReasonSchema.parse(body);
    await amendments.rejectAmendment(context, amendmentId, note, approvalGuardFrom(body));
    return apiOk({ data: { ok: true } });
  });
}
