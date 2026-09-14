import { apiOk, withContext } from "@/lib/api/respond";
import { timesheetFormOptions } from "@/lib/modules/timesheets/timesheet.service";

/** GET /api/timesheets/options — projects to log time to, and recent rows (PRD #42 §53). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await timesheetFormOptions(context) }));
}
