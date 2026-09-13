import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { getCalendar } from "@/lib/modules/calendar/calendar.query";
import { createEventSchema, rangeQuerySchema } from "@/lib/modules/calendar/calendar.schema";
import { createEvent } from "@/lib/modules/calendar/calendar.service";

/**
 * GET /api/calendar/events?from=…&to=… — every event this reader may see in a
 * bounded range (PRD #39 §64-§67). The range is mandatory and at most 93 days.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const query = rangeQuerySchema.parse({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      providers: params.getAll("providers").length ? params.getAll("providers") : undefined,
      categories: params.getAll("categories").length ? params.getAll("categories") : undefined,
      projectIds: params.getAll("projectIds").length ? params.getAll("projectIds") : undefined,
      memberIds: params.getAll("memberIds").length ? params.getAll("memberIds") : undefined,
      myOnly: params.get("myOnly") ?? undefined,
      includeAllDay: params.get("includeAllDay") ?? undefined,
    });
    return apiOk(
      await getCalendar(
        context,
        { from: new Date(query.from), to: new Date(query.to) },
        {
          providers: query.providers,
          categories: query.categories,
          projectIds: query.projectIds,
          memberIds: query.memberIds,
          myOnly: query.myOnly,
          includeAllDay: query.includeAllDay,
        },
      ),
    );
  });
}

/** POST /api/calendar/events — create a Calendar-owned event (PRD #39 §68). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) {
      return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    }
    const input = createEventSchema.parse(await readJson(request));
    return apiOk(await createEvent(context, input), { status: 201 });
  });
}
