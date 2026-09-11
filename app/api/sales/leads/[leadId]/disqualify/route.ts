import { readJson, withContext } from "@/lib/api/respond";
import { disqualifyLeadSchema } from "@/lib/modules/sales/leads/lead.schema";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/** Disqualifying must say why, so the reason survives the archive (PRD #17 §50). */
export async function POST(request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    const input = disqualifyLeadSchema.parse(await readJson(request));
    await leads.disqualifyLead(context, leadId, input.reason);
    return new Response(null, { status: 204 });
  });
}
