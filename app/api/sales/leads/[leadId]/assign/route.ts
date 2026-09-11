import { readJson, withContext } from "@/lib/api/respond";
import { assignLeadSchema } from "@/lib/modules/sales/leads/lead.schema";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/** Reassigns a lead (PRD #17 §47). */
export async function POST(request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    const input = assignLeadSchema.parse(await readJson(request));
    await leads.assignLead(context, leadId, input.ownerMemberId);
    return new Response(null, { status: 204 });
  });
}
