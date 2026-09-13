import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { moveEventSchema } from "@/lib/modules/calendar/calendar.schema";
import { moveEvent } from "@/lib/modules/calendar/calendar.service";

type Params = { params: Promise<{ eventId: string }> };

/** POST — drag or resize a single Calendar-owned event (PRD #39 §82-§84). */
export async function POST(request: Request, { params }: Params) {
  const { eventId } = await params;
  return withContext(async (context) => {
    const input = moveEventSchema.parse(await readJson(request));
    return apiOk(
      await moveEvent(context, eventId, { startsAt: new Date(input.startsAt), endsAt: input.endsAt ? new Date(input.endsAt) : undefined }),
    );
  });
}
