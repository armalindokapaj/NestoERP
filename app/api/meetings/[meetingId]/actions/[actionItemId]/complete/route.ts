import { apiOk, withContext } from "@/lib/api/respond";
import { completeActionItem } from "@/lib/modules/meetings/meeting.actions";

type Params = { params: Promise<{ meetingId: string; actionItemId: string }> };

/** POST — mark an action done (PRD #40 §168). */
export async function POST(_request: Request, { params }: Params) {
  const { meetingId, actionItemId } = await params;
  return withContext(async (context) => apiOk({ data: await completeActionItem(context, meetingId, actionItemId) }));
}
