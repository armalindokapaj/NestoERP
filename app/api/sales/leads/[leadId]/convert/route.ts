import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { convertLeadSchema } from "@/lib/modules/sales/leads/lead.schema";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/**
 * Lead → Opportunity, and optionally → Client (PRD #17 §51–§56).
 *
 * A second attempt answers 409: a lead converts once (PRD #17 §56).
 */
export async function POST(request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    const input = convertLeadSchema.parse(await readJson(request));
    return apiOk({ data: await leads.convertLead(context, leadId, input) }, { status: 201 });
  });
}
