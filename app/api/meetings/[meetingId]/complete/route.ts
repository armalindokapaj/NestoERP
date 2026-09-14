import { apiOk, withContext } from "@/lib/api/respond";
import { completeMeeting } from "@/lib/modules/meetings/meeting.service";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — IN_PROGRESS → COMPLETED; the minutes stay a draft until finalized (PRD #40 §100, §161). */
export async function POST(_request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await completeMeeting(context, meetingId) });
  });
}
