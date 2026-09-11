import { readJson, withContext } from "@/lib/api/respond";
import { proposalDeclineSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";

type Params = { params: Promise<{ proposalId: string }> };

/** The client said no (PRD #17 §122). */
export async function POST(request: Request, { params }: Params) {
  const { proposalId } = await params;
  return withContext(async (context) => {
    const input = proposalDeclineSchema.parse(await readJson(request).catch(() => ({})));
    await proposals.declineProposal(context, proposalId, input.note ?? null);
    return new Response(null, { status: 204 });
  });
}
