import { apiOk, withContext } from "@/lib/api/respond";
import { listMeetingActivity } from "@/lib/modules/meetings/meeting.service";

type Params = { params: Promise<{ meetingId: string }> };

/** GET — what happened on this meeting, newest first (PRD #40 §183). */
export async function GET(_request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => apiOk({ data: await listMeetingActivity(context, meetingId) }));
}
