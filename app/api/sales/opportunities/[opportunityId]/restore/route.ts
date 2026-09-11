import { withContext } from "@/lib/api/respond";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/** PRD #17 §197. */
export async function POST(_request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    await opportunities.restoreOpportunity(context, opportunityId);
    return new Response(null, { status: 204 });
  });
}
