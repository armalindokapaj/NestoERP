import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createAnnouncementSchema, feedQuerySchema } from "@/lib/modules/announcements/announcement.schema";
import { createAnnouncement, listAnnouncements } from "@/lib/modules/announcements/announcement.service";

/** GET — the feed for one tab: for me, pinned, unread, to acknowledge, history or manage (PRD #45 §59, §166, §178). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const search = new URL(request.url).searchParams;
    const query = feedQuerySchema.parse(Object.fromEntries(["tab", "priority", "audienceType", "status", "projectId", "departmentId", "q", "cursor", "limit"].flatMap((key) => (search.get(key) ? [[key, search.get(key)]] : []))));
    return apiOk({ data: await listAnnouncements(context, query) });
  });
}

/** POST — a new draft (PRD #45 §20, §36, §168). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createAnnouncementSchema.parse(await readJson(request));
    return apiOk({ data: await createAnnouncement(context, input) }, { status: 201 });
  });
}
