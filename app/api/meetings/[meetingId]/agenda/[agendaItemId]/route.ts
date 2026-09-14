import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { deleteAgendaItem, updateAgendaItem } from "@/lib/modules/meetings/meeting.agenda";
import { updateAgendaItemSchema } from "@/lib/modules/meetings/meeting.schema";

type Params = { params: Promise<{ meetingId: string; agendaItemId: string }> };

/** PATCH — edit an agenda item or mark it discussed, skipped or deferred (PRD #40 §103, §165). */
export async function PATCH(request: Request, { params }: Params) {
  const { meetingId, agendaItemId } = await params;
  return withContext(async (context) => {
    const input = updateAgendaItemSchema.parse(await readJson(request));
    return apiOk({ data: await updateAgendaItem(context, meetingId, agendaItemId, input) });
  });
}

/** DELETE — remove an agenda item (PRD #40 §165). */
export async function DELETE(_request: Request, { params }: Params) {
  const { meetingId, agendaItemId } = await params;
  return withContext(async (context) => apiOk({ data: await deleteAgendaItem(context, meetingId, agendaItemId) }));
}
