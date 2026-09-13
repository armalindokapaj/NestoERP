import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { participantsSchema } from "@/lib/modules/calendar/calendar.schema";
import { addParticipants } from "@/lib/modules/calendar/calendar.service";

type Params = { params: Promise<{ eventId: string }> };

/** POST — add same-company members to an event this reader may edit (PRD #39 §69). */
export async function POST(request: Request, { params }: Params) {
  const { eventId } = await params;
  return withContext(async (context) => {
    const { memberIds } = participantsSchema.parse(await readJson(request));
    return apiOk({ data: await addParticipants(context, eventId, memberIds) });
  });
}
