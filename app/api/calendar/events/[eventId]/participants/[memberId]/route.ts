import { withContext } from "@/lib/api/respond";
import { removeParticipant } from "@/lib/modules/calendar/calendar.service";

type Params = { params: Promise<{ eventId: string; memberId: string }> };

/** DELETE — the editor removes someone, or a participant leaves (PRD #39 §69). */
export async function DELETE(_request: Request, { params }: Params) {
  const { eventId, memberId } = await params;
  return withContext(async (context) => {
    await removeParticipant(context, eventId, memberId);
    return new Response(null, { status: 204 });
  });
}
