import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { duplicateMeetingSchema } from "@/lib/modules/meetings/meeting.schema";
import { duplicateMeeting } from "@/lib/modules/meetings/meeting.service";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — a new meeting with the same type, project, people, agenda and length (PRD #40 §221). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = duplicateMeetingSchema.parse(await readJson(request));
    return apiOk({ data: await duplicateMeeting(context, meetingId, input) });
  });
}
