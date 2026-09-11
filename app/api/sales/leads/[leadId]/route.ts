import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateLeadSchema } from "@/lib/modules/sales/leads/lead.schema";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/** GET/PATCH one lead (PRD #17 §196). Out of scope answers 404 (§226). */
export async function GET(_request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => apiOk({ data: await leads.getLead(context, leadId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    const input = updateLeadSchema.parse(await readJson(request));
    return apiOk({ data: await leads.updateLead(context, leadId, input) });
  });
}
