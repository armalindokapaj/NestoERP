import { readJson, withContext } from "@/lib/api/respond";
import { assignOpportunitySchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/** Reassigns a deal (PRD #17 §80). */
export async function POST(request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    const input = assignOpportunitySchema.parse(await readJson(request));
    await opportunities.assignOpportunity(context, opportunityId, input.ownerMemberId);
    return new Response(null, { status: 204 });
  });
}
