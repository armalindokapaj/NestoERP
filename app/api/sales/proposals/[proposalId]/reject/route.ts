import { readJson, withContext } from "@/lib/api/respond";
import { proposalRejectionSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ proposalId: string }> };

/** A rejection must say why (PRD #17 §118, §419). */
export async function POST(request: Request, { params }: Params) {
  const { proposalId } = await params;
  return withContext(async (context) => {
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request);
    const input = proposalRejectionSchema.parse(body);
    await proposals.rejectProposal(context, proposalId, input.note, approvalGuardFrom(body));
    return new Response(null, { status: 204 });
  });
}
