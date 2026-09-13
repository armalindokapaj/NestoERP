import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateEventSchema } from "@/lib/modules/calendar/calendar.schema";
import { archiveEvent, getEvent, updateEvent } from "@/lib/modules/calendar/calendar.service";

type Params = { params: Promise<{ eventId: string }> };

/** GET — one Calendar-owned event, if this reader may see it; otherwise not found (PRD #39 §194). */
export async function GET(_request: Request, { params }: Params) {
  const { eventId } = await params;
  return withContext(async (context) => apiOk({ data: await getEvent(context, eventId) }));
}

/** PATCH — edit the event; for a series, the whole series (PRD #39 §80). */
export async function PATCH(request: Request, { params }: Params) {
  const { eventId } = await params;
  return withContext(async (context) => {
    const input = updateEventSchema.parse(await readJson(request));
    return apiOk(await updateEvent(context, eventId, input));
  });
}

/** DELETE — archive, never a hard delete (PRD #39 §68, §114). */
export async function DELETE(_request: Request, { params }: Params) {
  const { eventId } = await params;
  return withContext(async (context) => {
    await archiveEvent(context, eventId);
    return new Response(null, { status: 204 });
  });
}
