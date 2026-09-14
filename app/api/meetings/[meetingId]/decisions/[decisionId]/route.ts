import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { archiveDecision, updateDecision } from "@/lib/modules/meetings/meeting.decisions";
import { updateDecisionSchema } from "@/lib/modules/meetings/meeting.schema";

type Params = { params: Promise<{ meetingId: string; decisionId: string }> };

/** PATCH — edit a decision while the minutes are a draft (PRD #40 §167). */
export async function PATCH(request: Request, { params }: Params) {
  const { meetingId, decisionId } = await params;
  return withContext(async (context) => {
    const input = updateDecisionSchema.parse(await readJson(request));
    return apiOk({ data: await updateDecision(context, meetingId, decisionId, input) });
  });
}

/** DELETE — archive a decision; its number is never reused (PRD #40 §167). */
export async function DELETE(_request: Request, { params }: Params) {
  const { meetingId, decisionId } = await params;
  return withContext(async (context) => apiOk({ data: await archiveDecision(context, meetingId, decisionId) }));
}
