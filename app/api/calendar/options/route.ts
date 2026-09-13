import { apiOk, withContext } from "@/lib/api/respond";
import { calendarFormOptions, searchInvitees } from "@/lib/modules/calendar/calendar.options";

/** GET /api/calendar/options[?q=] — what the create drawer may offer; with `q`, invitees by name. */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    if (params.has("q")) return apiOk({ data: await searchInvitees(context, params.get("q") ?? undefined) });
    return apiOk({ data: await calendarFormOptions(context) });
  });
}
