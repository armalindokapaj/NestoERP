import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { minutesSectionSchema } from "@/lib/modules/meetings/meeting.schema";
import { addMinutesSection } from "@/lib/modules/meetings/meeting.minutes";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — add a minutes section (PRD #40 §44, §166). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = minutesSectionSchema.parse(await readJson(request));
    return apiOk({ data: await addMinutesSection(context, meetingId, input) });
  });
}
