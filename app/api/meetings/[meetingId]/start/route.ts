import { apiOk, withContext } from "@/lib/api/respond";
import { startMeeting } from "@/lib/modules/meetings/meeting.service";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — SCHEDULED → IN_PROGRESS (PRD #40 §99, §160). */
export async function POST(_request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await startMeeting(context, meetingId) });
  });
}
