import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { agendaItemSchema } from "@/lib/modules/meetings/meeting.schema";
import { addAgendaItem } from "@/lib/modules/meetings/meeting.agenda";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — add an agenda item (PRD #40 §34, §165). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = agendaItemSchema.parse(await readJson(request));
    return apiOk({ data: await addAgendaItem(context, meetingId, input) });
  });
}
