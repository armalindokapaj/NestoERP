import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentNoteSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

/** PENDING_APPROVAL → APPROVED (PRD #18 §171). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, amendmentId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request);
    const { note } = amendmentNoteSchema.parse(body);
    await amendments.approveAmendment(context, amendmentId, note ?? null, approvalGuardFrom(body));
    return apiOk({ data: { ok: true } });
  });
}
