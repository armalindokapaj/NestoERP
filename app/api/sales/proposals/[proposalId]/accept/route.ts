import { withContext } from "@/lib/api/respond";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";

type Params = { params: Promise<{ proposalId: string }> };

/** PRD #17 §198. */
export async function POST(_request: Request, { params }: Params) {
  const { proposalId } = await params;
  return withContext(async (context) => {
    await proposals.acceptProposal(context, proposalId);
    return new Response(null, { status: 204 });
  });
}
