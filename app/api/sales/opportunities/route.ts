import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createOpportunitySchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";
import { parseOpportunityQuery } from "@/lib/modules/sales/sales.query";

/**
 * GET  /api/sales/opportunities — scoped, filtered, paginated (PRD #17 §197).
 * POST /api/sales/opportunities — open a deal.
 *
 * The list reads the active workspace (Workspace Context §37): a company's own,
 * or in the Group workspace the union of every authorised company's, each row
 * naming its company. Opening a deal belongs to one company and is refused
 * there.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(
      await opportunities.listOpportunitiesForWorkspace(context, parseOpportunityQuery(url.searchParams)),
    );
  }, { group: "read" });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createOpportunitySchema.parse(await readJson(request));
    return apiOk({ data: await opportunities.createOpportunity(context, input) }, { status: 201 });
  });
}
