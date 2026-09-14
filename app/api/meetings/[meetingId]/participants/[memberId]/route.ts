import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { removeParticipant, updateParticipant } from "@/lib/modules/meetings/meeting.participants";
import { updateParticipantSchema } from "@/lib/modules/meetings/meeting.schema";

type Params = { params: Promise<{ meetingId: string; memberId: string }> };

/** PATCH — role, required/optional, or attendance (PRD #40 §112-§114, §134, §164). */
export async function PATCH(request: Request, { params }: Params) {
  const { meetingId, memberId } = await params;
  return withContext(async (context) => {
    const input = updateParticipantSchema.parse(await readJson(request));
    return apiOk({ data: await updateParticipant(context, meetingId, memberId, input) });
  });
}

/** DELETE — take someone off the meeting; never the organizer (PRD #40 §135, §164). `?scope=FUTURE` for later meetings too. */
export async function DELETE(request: Request, { params }: Params) {
  const { meetingId, memberId } = await params;
  return withContext(async (context) => {
    const scope = new URL(request.url).searchParams.get("scope") === "FUTURE" ? "FUTURE" : "THIS";
    return apiOk({ data: await removeParticipant(context, meetingId, memberId, scope) });
  });
}
