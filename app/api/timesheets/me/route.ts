import { apiOk, withContext } from "@/lib/api/respond";
import { weekQuerySchema } from "@/lib/modules/timesheets/timesheet.schema";
import { getMyWeek } from "@/lib/modules/timesheets/timesheet.service";

/** GET /api/timesheets/me?week=YYYY-MM-DD — the signed-in member's week (PRD #42 §144). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const query = weekQuerySchema.parse({ week: params.get("week") ?? undefined });
    return apiOk({ data: await getMyWeek(context, query) });
  });
}
