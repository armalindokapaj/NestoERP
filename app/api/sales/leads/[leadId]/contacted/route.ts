import { withContext } from "@/lib/api/respond";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/** NEW → CONTACTED (PRD #17 §48). */
export async function POST(_request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    await leads.markLeadContacted(context, leadId);
    return new Response(null, { status: 204 });
  });
}
