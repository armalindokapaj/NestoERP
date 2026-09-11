import { readJson, withContext } from "@/lib/api/respond";
import { opportunityStageSchema } from "@/lib/modules/sales/opportunities/opportunity.schema";
import * as opportunities from "@/lib/modules/sales/opportunities/opportunity.service";

type Params = { params: Promise<{ opportunityId: string }> };

/**
 * Moves a deal along the pipeline (PRD #17 §81, §101).
 *
 * This is what a Kanban drag calls. The server validates the transition and the
 * update is conditional on the stage the board was showing, so a stale card
 * cannot overwrite somebody else's move (PRD #17 §101, §254).
 */
export async function POST(request: Request, { params }: Params) {
  const { opportunityId } = await params;
  return withContext(async (context) => {
    const input = opportunityStageSchema.parse(await readJson(request));
    await opportunities.changeStage(context, opportunityId, input.stage);
    return new Response(null, { status: 204 });
  });
}
