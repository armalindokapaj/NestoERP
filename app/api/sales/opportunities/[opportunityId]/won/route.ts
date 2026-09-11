import { readJson, withContext } from "@/lib/api/respond";
import { opportunityWonSchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/**
 * Wins a deal (PRD #17 §84–§92).
 *
 * Resolves or creates the canonical Client and, optionally, the canonical
 * Project — in one transaction. A second attempt answers 409 (PRD #17 §92).
 */
export async function POST(request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    const input = opportunityWonSchema.parse(await readJson(request));
    await opportunities.markWon(context, opportunityId, input);
    return new Response(null, { status: 204 });
  });
}
