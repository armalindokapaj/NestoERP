import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { respondSchema } from "@/lib/modules/calendar/calendar.schema";
import { respondToEvent } from "@/lib/modules/calendar/calendar.service";

type Params = { params: Promise<{ eventId: string }> };

/** POST — accept, decline or tentatively accept an invitation (PRD #39 §40, §69). */
export async function POST(request: Request, { params }: Params) {
  const { eventId } = await params;
  return withContext(async (context) => {
    const { status } = respondSchema.parse(await readJson(request));
    return apiOk({ data: await respondToEvent(context, eventId, status) });
  });
}
