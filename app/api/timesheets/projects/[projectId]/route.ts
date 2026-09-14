import { apiOk, withContext } from "@/lib/api/respond";
import { projectTimeSummary } from "@/lib/modules/timesheets/timesheet.reports";
import { parseProjectSummaryQuery } from "@/lib/modules/timesheets/timesheet.schema";

type Params = { params: Promise<{ projectId: string }> };

/** GET /api/timesheets/projects/:projectId — one project's hours (PRD #42 §154). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await projectTimeSummary(context, parseProjectSummaryQuery(new URL(request.url).searchParams, projectId)) }));
}
