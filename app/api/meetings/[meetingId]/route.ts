import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateMeetingSchema } from "@/lib/modules/meetings/meeting.schema";
import { getMeeting, updateMeeting } from "@/lib/modules/meetings/meeting.service";

type Params = { params: Promise<{ meetingId: string }> };

/** GET — one meeting, if this reader may open it; otherwise not found (PRD #40 §157, §231). */
export async function GET(_request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => apiOk({ data: await getMeeting(context, meetingId) }));
}

/** PATCH — edit, with the version the form loaded; a stale version is a 409 (PRD #40 §158, §178, §179). */
export async function PATCH(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = updateMeetingSchema.parse(await readJson(request));
    return apiOk({ data: await updateMeeting(context, meetingId, input) });
  });
}
