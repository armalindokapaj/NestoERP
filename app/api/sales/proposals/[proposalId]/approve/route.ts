import { readJson, withContext } from "@/lib/api/respond";
import { proposalDecisionSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";

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
    const input = proposalDecisionSchema.parse(await readJson(request).catch(() => ({})));
    await proposals.approveProposal(context, proposalId, input.note ?? null);
    return new Response(null, { status: 204 });
  });
}
