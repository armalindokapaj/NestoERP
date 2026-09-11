import { withContext } from "@/lib/api/respond";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/** NEW or CONTACTED → QUALIFIED (PRD #17 §49). */
export async function POST(_request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    await leads.qualifyLead(context, leadId);
    return new Response(null, { status: 204 });
  });
}
