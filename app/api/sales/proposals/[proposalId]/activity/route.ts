import { apiOk, withContext } from "@/lib/api/respond";
import * as activity from "@/lib/modules/sales/sales.activity";
import * as proposals from "@/lib/modules/sales/proposals/proposal.service";

type Params = { params: Promise<{ proposalId: string }> };

/** One proposal's history, after the proposal has been shown to be reachable. */
export async function GET(request: Request, { params }: Params) {
  const { proposalId } = await params;
  return withContext(async (context) => {
    await proposals.getProposal(context, proposalId);

    const url = new URL(request.url);
    return apiOk(
      await activity.listRecordActivity(context, "Proposal", proposalId, {
        page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
        limit: Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25,
      }),
    );
  });
}
