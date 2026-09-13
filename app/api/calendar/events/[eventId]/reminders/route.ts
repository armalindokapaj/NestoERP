import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reminderSchema } from "@/lib/modules/calendar/calendar.schema";
import { addReminder } from "@/lib/modules/calendar/calendar.service";

type Params = { params: Promise<{ eventId: string }> };

/**
 * POST — a reminder for the caller, on an event they can see (PRD #39 §70).
 * There is no target field: a reminder cannot be aimed at somebody else (PRD #39 §194).
 */
export async function POST(request: Request, { params }: Params) {
  const { eventId } = await params;
  return withContext(async (context) => {
    const input = reminderSchema.parse(await readJson(request));
    return apiOk({ data: await addReminder(context, eventId, input) }, { status: 201 });
  });
}
