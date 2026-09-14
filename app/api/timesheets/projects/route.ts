import { apiOk, withContext } from "@/lib/api/respond";
import { projectTimeSummary } from "@/lib/modules/timesheets/timesheet.reports";
import { parseProjectSummaryQuery } from "@/lib/modules/timesheets/timesheet.schema";

/** GET /api/timesheets/projects — hours across the projects this reader reports on (PRD #42 §90-§92). */
export async function GET(request: Request) {
  return withContext(async (context) => apiOk({ data: await projectTimeSummary(context, parseProjectSummaryQuery(new URL(request.url).searchParams)) }));
}
