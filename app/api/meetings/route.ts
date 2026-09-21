import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createMeetingSchema, meetingListQuerySchema } from "@/lib/modules/meetings/meeting.schema";
import { createMeeting } from "@/lib/modules/meetings/meeting.service";
import { listMeetingsForWorkspace } from "@/lib/modules/meetings/meeting.workspace";

/**
 * GET /api/meetings — meetings this reader can open (PRD #40 §155), filtered by
 * section, date range, project, type, status, organizer and participant. In the
 * Group workspace: the meetings they can open in every company they may open
 * Meetings in, each row naming its company; `company` narrows it and is checked
 * against those companies (Workspace Context §34, §58, §86). A create is refused
 * there — it belongs to one company.
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
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
        company: params.get("company") ?? undefined,
        page: params.get("page") ?? undefined,
        limit: params.get("limit") ?? undefined,
      });
      return apiOk(await listMeetingsForWorkspace(context, query));
    },
    { group: "read" },
  );
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
