import { apiOk, withContext } from "@/lib/api/respond";
import { finalizeMinutes } from "@/lib/modules/meetings/meeting.minutes";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — freeze the minutes as the formal record (PRD #40 §46, §48, §166). */
export async function POST(_request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await finalizeMinutes(context, meetingId) });
  });
}
