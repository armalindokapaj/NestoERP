import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { copyDaySchema } from "@/lib/modules/timesheets/timesheet.schema";
import { copyDay } from "@/lib/modules/timesheets/timesheet.worklogs";

/** POST /api/timesheets/copy-day — one day's entries onto another day (PRD #42 §50). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = copyDaySchema.parse(await readJson(request));
    return apiOk({ data: await copyDay(context, input) });
  });
}
