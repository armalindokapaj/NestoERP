import { withContext } from "@/lib/api/respond";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/** PRD #17 §57. */
export async function POST(_request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    await leads.archiveLead(context, leadId);
    return new Response(null, { status: 204 });
  });
}
