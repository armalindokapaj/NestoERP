import { AccessError } from "@/lib/access/guards";
import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { addEntry } from "@/lib/modules/daily-logs/daily-log.entries";
import { SECTION_SCHEMAS } from "@/lib/modules/daily-logs/daily-log.schema";
import { SECTION_KEYS, type SectionKey } from "@/lib/modules/daily-logs/daily-log.types";

type Params = { params: Promise<{ dailyLogId: string; section: string }> };

/** POST — add an entry to a section: weather, workforce, activities, equipment, deliveries, visitors, delays, instructions (PRD #43 §166-§172). */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId, section } = await params;
  return withContext(async (context) => {
    if (!(SECTION_KEYS as readonly string[]).includes(section)) throw new AccessError("NOT_FOUND");
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const key = section as SectionKey;
    const input = SECTION_SCHEMAS[key].parse(await readJson(request));
    return apiOk({ data: await addEntry(context, dailyLogId, key, input as never) }, { status: 201 });
  });
}
