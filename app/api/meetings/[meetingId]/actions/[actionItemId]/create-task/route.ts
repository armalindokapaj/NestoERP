import { apiOk, withContext } from "@/lib/api/respond";
import { convertActionToTask } from "@/lib/modules/meetings/meeting.actions";

type Params = { params: Promise<{ meetingId: string; actionItemId: string }> };

/** POST — create the canonical Task for this action, once (PRD #40 §56-§58, §168). */
export async function POST(_request: Request, { params }: Params) {
  const { meetingId, actionItemId } = await params;
  return withContext(async (context) => apiOk({ data: await convertActionToTask(context, meetingId, actionItemId) }, { status: 201 }));
}
