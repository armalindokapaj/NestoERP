import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createOpportunitySchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { parseOpportunityQuery } from "@/lib/modules/sales/sales.query";

/**
 * GET  /api/sales/opportunities — scoped, filtered, paginated (PRD #17 §197).
 * POST /api/sales/opportunities — open a deal.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(
      await opportunities.listOpportunities(context, parseOpportunityQuery(url.searchParams)),
    );
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createOpportunitySchema.parse(await readJson(request));
    return apiOk({ data: await opportunities.createOpportunity(context, input) }, { status: 201 });
  });
}
