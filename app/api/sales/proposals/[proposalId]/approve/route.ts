import { readJson, withContext } from "@/lib/api/respond";
import { proposalDecisionSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ proposalId: string }> };

/**
 * Approves the price a client will be quoted (PRD #17 §117).
 *
 * Refused for the person who submitted it, unless they hold
 * `sales.approval.self` (PRD #17 §20).
 */
export async function POST(request: Request, { params }: Params) {
  const { proposalId } = await params;
  return withContext(async (context) => {
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request).catch((): Record<string, unknown> => ({}));
    const input = proposalDecisionSchema.parse(body);
    await proposals.approveProposal(context, proposalId, input.note ?? null, approvalGuardFrom(body));
    return new Response(null, { status: 204 });
  });
}
