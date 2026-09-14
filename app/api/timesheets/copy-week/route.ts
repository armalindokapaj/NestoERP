import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { copyWeekSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { copyPreviousWeek } from "@/lib/modules/timesheets/timesheet.worklogs";

/** POST /api/timesheets/copy-week — last week's rows, with or without their time (PRD #42 §51). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = copyWeekSchema.parse(await readJson(request));
    return apiOk({ data: await copyPreviousWeek(context, input) });
  });
}
