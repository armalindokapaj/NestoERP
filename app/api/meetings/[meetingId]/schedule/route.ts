import { apiOk, withContext } from "@/lib/api/respond";
import { scheduleMeeting } from "@/lib/modules/meetings/meeting.service";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — DRAFT → SCHEDULED; invitations go out now (PRD #40 §159). */
export async function POST(_request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await scheduleMeeting(context, meetingId) });
  });
}
