import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { respondSchema } from "@/lib/modules/meetings/meeting.schema";
import { respondToMeeting } from "@/lib/modules/meetings/meeting.participants";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — the caller's own reply; reauthorised on every call (PRD #40 §132, §133, §163). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = respondSchema.parse(await readJson(request));
    return apiOk({ data: await respondToMeeting(context, meetingId, input.response) });
  });
}
