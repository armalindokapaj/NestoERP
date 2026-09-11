import { apiOk, withContext } from "@/lib/api/respond";
import * as activity from "@/lib/modules/sales/sales.activity";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/** One deal's history, after the deal itself has been shown to be reachable. */
export async function GET(request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    await opportunities.getOpportunity(context, opportunityId);

    const url = new URL(request.url);
    return apiOk(
      await activity.listRecordActivity(context, "Opportunity", opportunityId, {
        page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
        limit: Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25,
      }),
    );
  });
}
