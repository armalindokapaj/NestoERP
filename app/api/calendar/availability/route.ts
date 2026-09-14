import { apiOk, withContext } from "@/lib/api/respond";
import { getAvailability } from "@/lib/modules/calendar/calendar.availability";
import { availabilityQuerySchema } from "@/lib/modules/calendar/calendar.schema";
import { calendarSettings } from "@/lib/modules/calendar/calendar.service";

/**
 * GET /api/calendar/availability?memberIds=…&from=…&to=… — busy intervals, no detail (PRD #39 §87, §88).
 * `excludeEventId` / `excludeMeetingId` leave out the record being edited, so it does not conflict with itself.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const query = availabilityQuerySchema.parse({
      memberIds: params.getAll("memberIds"),
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      excludeEventId: params.get("excludeEventId") ?? undefined,
      excludeMeetingId: params.get("excludeMeetingId") ?? undefined,
    });
    const settings = await calendarSettings(context.companyId);
    return apiOk({
      data: await getAvailability(
        context,
        { memberIds: query.memberIds!, from: new Date(query.from), to: new Date(query.to), excludeEventId: query.excludeEventId, excludeMeetingId: query.excludeMeetingId },
        settings.timezone,
      ),
    });
  });
}
