import { z } from "zod";

import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { addParticipants } from "@/lib/modules/meetings/meeting.participants";
import { addParticipantsSchema } from "@/lib/modules/meetings/meeting.schema";

type Params = { params: Promise<{ meetingId: string }> };

const bodySchema = addParticipantsSchema.extend({ scope: z.enum(["THIS", "FUTURE"]).default("THIS") });

/** POST — add participants; for a series, optionally to every later meeting too (PRD #40 §134, §164). */
export async function POST(request: Request, { params }: Params) {
  const { meetingId } = await params;
  return withContext(async (context) => {
    const input = bodySchema.parse(await readJson(request));
    return apiOk({ data: await addParticipants(context, meetingId, input) });
  });
}
