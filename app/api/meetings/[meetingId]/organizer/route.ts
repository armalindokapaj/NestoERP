import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { transferOrganizerSchema } from "@/lib/modules/meetings/meeting.schema";
import { transferOrganizer } from "@/lib/modules/meetings/meeting.participants";

type Params = { params: Promise<{ meetingId: string }> };

/** POST — hand the organizer role to another member (PRD #40 §136). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = transferOrganizerSchema.parse(await readJson(request));
    return apiOk({ data: await transferOrganizer(context, meetingId, input.memberId) });
  });
}
