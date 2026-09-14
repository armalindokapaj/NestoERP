import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { cancelMeetingSchema } from "@/lib/modules/meetings/meeting.schema";
import { cancelMeeting } from "@/lib/modules/meetings/meeting.service";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — cancel this meeting, or this and later meetings of its series (PRD #40 §101, §162, §228). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = cancelMeetingSchema.parse(await readJson(request));
    return apiOk({ data: await cancelMeeting(context, meetingId, input) });
  });
}
