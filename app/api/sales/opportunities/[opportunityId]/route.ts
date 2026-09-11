import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateOpportunitySchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/** GET/PATCH one opportunity (PRD #17 §197). Out of scope answers 404 (§226). */
export async function GET(_request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await opportunities.getOpportunity(context, opportunityId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    const input = updateOpportunitySchema.parse(await readJson(request));
    return apiOk({ data: await opportunities.updateOpportunity(context, opportunityId, input) });
  });
}
