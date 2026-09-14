import { apiOk, withContext } from "@/lib/api/respond";
import { meetingFormOptions, searchMeetingPeople } from "@/lib/modules/meetings/meeting.options";

/** GET /api/meetings/options[?q=] — what the meeting form may offer; with `q`, people by name. */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    if (params.has("q")) {
      return apiOk({ data: await searchMeetingPeople(context, params.get("q") ?? undefined, { includeSelf: params.get("self") === "true" }) });
    }
    return apiOk({ data: await meetingFormOptions(context) });
  });
}
