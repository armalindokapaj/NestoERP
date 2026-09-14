import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateActionItem } from "@/lib/modules/meetings/meeting.actions";
import { updateActionItemSchema } from "@/lib/modules/meetings/meeting.schema";

type Params = { params: Promise<{ meetingId: string; actionItemId: string }> };

/** PATCH — edit an action, or move it along; a linked action follows its task (PRD #40 §59, §168). */
export async function PATCH(request: Request, { params }: Params) {
  const { meetingId, actionItemId } = await params;
  return withContext(async (context) => {
    const input = updateActionItemSchema.parse(await readJson(request));
    return apiOk({ data: await updateActionItem(context, meetingId, actionItemId, input) });
  });
}
