import { apiOk, withContext } from "@/lib/api/respond";
import { dailyLogReport } from "@/lib/modules/daily-logs/daily-log.reports";
import { reportQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";

/** GET /api/daily-logs/reports — site reporting over logs this reader can open (PRD #43 §196-§200). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const search = new URL(request.url).searchParams;
    const query = reportQuerySchema.parse({ projectId: search.get("projectId") ?? undefined, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined });
    return apiOk({ data: await dailyLogReport(context, query) });
  });
}
