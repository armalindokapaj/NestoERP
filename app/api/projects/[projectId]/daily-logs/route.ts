import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createDailyLogSchema, listQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { createDailyLog, listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";

type Params = { params: Promise<{ projectId: string }> };

/** GET — a project's daily logs, newest first, filtered by dates, status and author (PRD #43 §162). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const search = new URL(request.url).searchParams;
    const query = listQuerySchema.parse({ projectId, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, status: search.get("status") ?? undefined, authorId: search.get("author") ?? undefined, page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined });
    return apiOk({ data: await listDailyLogs(context, query) });
  });
}

/** POST — start the project's log for a day, or get the one already started (PRD #43 §10, §163). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const body = (await readJson(request)) as Record<string, unknown>;
    const input = createDailyLogSchema.parse({ ...body, projectId });
    const result = await createDailyLog(context, input);
    return apiOk({ data: result }, { status: result.created ? 201 : 200 });
  });
}
