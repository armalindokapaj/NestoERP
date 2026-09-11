import { withContext } from "@/lib/api/respond";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/** LOST → QUALIFIED. A won deal never reopens in V0.1 (PRD #17 §96). */
export async function POST(_request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    await opportunities.reopenOpportunity(context, opportunityId);
    return new Response(null, { status: 204 });
  });
}
