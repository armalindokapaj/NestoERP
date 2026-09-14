import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { applyTemplateSchema } from "@/lib/modules/meetings/meeting.schema";
import { applyAgendaTemplate } from "@/lib/modules/meetings/meeting.agenda";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — append a static agenda template (PRD #40 §38, §39). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = applyTemplateSchema.parse(await readJson(request));
    return apiOk({ data: await applyAgendaTemplate(context, meetingId, input.template) });
  });
}
