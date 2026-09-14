import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderSchema } from "@/lib/modules/meetings/meeting.schema";
import { reorderAgenda } from "@/lib/modules/meetings/meeting.agenda";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — the agenda in its new order; every item exactly once (PRD #40 §35, §165). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = reorderSchema.parse(await readJson(request));
    return apiOk({ data: await reorderAgenda(context, meetingId, input.itemIds) });
  });
}
