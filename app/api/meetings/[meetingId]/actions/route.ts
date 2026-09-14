import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { actionItemSchema } from "@/lib/modules/meetings/meeting.schema";
import { createActionItem } from "@/lib/modules/meetings/meeting.actions";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — add an action item, optionally with its Task (PRD #40 §53, §107, §168). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = actionItemSchema.parse(await readJson(request));
    return apiOk({ data: await createActionItem(context, meetingId, input) });
  });
}
