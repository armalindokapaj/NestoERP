import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reopenMinutesSchema } from "@/lib/modules/meetings/meeting.schema";
import { reopenMinutes } from "@/lib/modules/meetings/meeting.minutes";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — reopen final minutes, with a reason; audited (PRD #40 §47, §166). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = reopenMinutesSchema.parse(await readJson(request));
    return apiOk({ data: await reopenMinutes(context, meetingId, input.reason) });
  });
}
