import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractNoteSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ contractId: string }> };

/** PENDING_APPROVAL → APPROVED (PRD #18 §113). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request);
    const { note } = contractNoteSchema.parse(body);
    await contracts.approveContract(context, contractId, note ?? null, approvalGuardFrom(body));
    return apiOk({ data: { ok: true } });
  });
}
