import { apiOk, withContext } from "@/lib/api/respond";
import { convertActionToTask } from "@/lib/modules/meetings/meeting.actions";

type Params = { params: Promise<{ meetingId: string; actionItemId: string }> };

/**
 * POST — create the canonical Task for this action, once (PRD #40 §56-§58, §168).
 * A retry of a finished conversion answers 200 with the same meeting and task,
 * not a second task and not an error (AUD-10 §5, CW-07); a new task is 201.
 */
export async function POST(_request: Request, { params }: Params) {
  const { meetingId, actionItemId } = await params;
  return withContext(async (context) => {
    const result = await convertActionToTask(context, meetingId, actionItemId);
    return apiOk({ data: result.meeting }, { status: result.created ? 201 : 200 });
  });
}
