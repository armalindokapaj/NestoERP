import { apiOk, withContext } from "@/lib/api/respond";
import { listQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { listDailyLogs } from "@/lib/modules/daily-logs/daily-log.service";

/** GET /api/daily-logs — logs across the projects this reader can open (PRD #43 §5). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const search = new URL(request.url).searchParams;
    const query = listQuerySchema.parse({ projectId: search.get("projectId") ?? undefined, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, status: search.get("status") ?? undefined, authorId: search.get("author") ?? undefined, q: search.get("q") ?? undefined, page: search.get("page") ?? undefined, pageSize: search.get("pageSize") ?? undefined });
    return apiOk({ data: await listDailyLogs(context, query, { reviewQueue: search.get("queue") === "review" }) });
  });
}
