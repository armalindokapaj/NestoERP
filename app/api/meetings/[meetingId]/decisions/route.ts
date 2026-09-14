import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { decisionSchema } from "@/lib/modules/meetings/meeting.schema";
import { recordDecision } from "@/lib/modules/meetings/meeting.decisions";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — record a decision (PRD #40 §50, §167). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = decisionSchema.parse(await readJson(request));
    return apiOk({ data: await recordDecision(context, meetingId, input) });
  });
}
