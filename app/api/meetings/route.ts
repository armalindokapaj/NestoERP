import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createMeetingSchema, meetingListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { createMeeting, listMeetings } from "@/lib/modules/meetings/meeting.service";

/**
 * GET /api/meetings — meetings this reader can open (PRD #40 §155), filtered by
 * section, date range, project, type, status, organizer and participant.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const many = (key: string) => (params.getAll(key).length ? params.getAll(key) : undefined);
    const query = meetingListQuerySchema.parse({
      section: params.get("section") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      type: many("type"),
      status: many("status"),
      myOnly: params.get("myOnly") ?? undefined,
      participantId: params.get("participantId") ?? undefined,
      organizerId: params.get("organizerId") ?? undefined,
      q: params.get("q") ?? undefined,
      page: params.get("page") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    return apiOk(await listMeetings(context, query));
  });
}

/** POST /api/meetings — create a meeting, or a series of them (PRD #40 §156, §222). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) {
      return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    }
    const input = createMeetingSchema.parse(await readJson(request));
    return apiOk({ data: await createMeeting(context, input) }, { status: 201 });
  });
}
