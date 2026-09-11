import { apiOk, withContext } from "@/lib/api/respond";
import * as activity from "@/lib/modules/sales/sales.activity";
import * as leads from "@/lib/modules/sales/leads/lead.service";

type Params = { params: Promise<{ leadId: string }> };

/**
 * One lead's history (PRD #17 §196).
 *
 * The lead is resolved through the scope first, so the trail cannot be read for
 * a record the caller may not open (PRD #17 §148).
 */
export async function GET(request: Request, { params }: Params) {
  const { leadId } = await params;
  return withContext(async (context) => {
    await leads.getLead(context, leadId);

    const url = new URL(request.url);
    return apiOk(
      await activity.listRecordActivity(context, "Lead", leadId, {
        page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
        limit: Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25,
      }),
    );
  });
}
