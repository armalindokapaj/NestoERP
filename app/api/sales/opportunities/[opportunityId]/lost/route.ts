import { readJson, withContext } from "@/lib/api/respond";
import { opportunityLostSchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/** Loses a deal, with a reason — and a note when that reason is OTHER (§93, §95). */
export async function POST(request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    const input = opportunityLostSchema.parse(await readJson(request));
    await opportunities.markLost(context, opportunityId, input);
    return new Response(null, { status: 204 });
  });
}
