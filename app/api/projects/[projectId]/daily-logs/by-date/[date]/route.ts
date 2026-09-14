import { apiOk, withContext } from "@/lib/api/respond";
import { isLocalDate } from "@/lib/modules/calendar/calendar.time";
import { findLogByDate, getDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { AccessError } from "@/lib/access/guards";

type Params = { params: Promise<{ projectId: string; date: string }> };

/** GET — the project's log for one day, or not found (PRD #43 §163). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId, date } = await params;
  return withContext(async (context) => {
    if (!isLocalDate(date)) throw new AccessError("VALIDATION_ERROR", "Use a date in the form YYYY-MM-DD.");
    const id = await findLogByDate(context, projectId, date);
    if (!id) throw new AccessError("NOT_FOUND", "There is no log for that day.", { code: "DAILY_LOG_NOT_FOUND" });
    return apiOk({ data: await getDailyLog(context, id) });
  });
}
