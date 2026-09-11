import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createLeadSchema } from "@/lib/modules/sales/leads/lead.schema";
import * as leads from "@/lib/modules/sales/leads/lead.service";
import { parseLeadQuery } from "@/lib/modules/sales/sales.query";

/**
 * GET  /api/sales/leads — scoped, filtered, paginated (PRD #17 §196).
 * POST /api/sales/leads — capture a lead.
 *
 * `acceptDuplicate` is read separately from the validated body: the duplicate
 * check is a warning a person answers, not a field of the lead (PRD #17 §44).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await leads.listLeads(context, parseLeadQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const body = await readJson(request);
    const input = createLeadSchema.parse(body);
    const acceptDuplicate = body.acceptDuplicate === true;

    return apiOk({ data: await leads.createLead(context, input, { acceptDuplicate }) }, { status: 201 });
  });
}
