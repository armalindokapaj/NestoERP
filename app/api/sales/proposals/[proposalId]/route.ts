import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateProposalSchema } from "@/lib/modules/sales/proposals/proposal.schema";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";

type Params = { params: Promise<{ proposalId: string }> };

/** GET/PATCH one proposal (PRD #17 §198). Out of scope answers 404 (§226). */
export async function GET(_request: Request, { params }: Params) {
  const { proposalId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await proposals.getProposal(context, proposalId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { proposalId } = await params;
  return withContext(async (context) => {
    const input = updateProposalSchema.parse(await readJson(request));
    return apiOk({ data: await proposals.updateProposal(context, proposalId, input) });
  });
}
