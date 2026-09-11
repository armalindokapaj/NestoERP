import { readJson, withContext } from "@/lib/api/respond";
import { proposalRejectionSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";

type Params = { params: Promise<{ proposalId: string }> };

/** A rejection must say why (PRD #17 §118, §419). */
export async function POST(request: Request, { params }: Params) {
  const { proposalId } = await params;
  return withContext(async (context) => {
    const input = proposalRejectionSchema.parse(await readJson(request));
    await proposals.rejectProposal(context, proposalId, input.note);
    return new Response(null, { status: 204 });
  });
}
