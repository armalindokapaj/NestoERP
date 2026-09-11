import { withContext } from "@/lib/api/respond";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/** Returns the lead to the status it held before archiving (PRD #17 §58). */
export async function POST(_request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    await leads.restoreLead(context, leadId);
    return new Response(null, { status: 204 });
  });
}
