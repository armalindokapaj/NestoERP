import { apiOk, withContext } from "@/lib/api/respond";
import { listTeamTimesheets } from "@/lib/modules/timesheets/timesheet.reports";
import { teamQuerySchema } from "@/lib/modules/timesheets/timesheet.schema";

/** GET /api/timesheets/team — the weeks of the people this reader oversees (PRD #42 §87-§89, §153). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const query = teamQuerySchema.parse({
      week: params.get("week") ?? undefined,
      status: params.get("status") ?? undefined,
      departmentId: params.get("departmentId") ?? undefined,
      memberId: params.get("memberId") ?? undefined,
      approverMemberId: params.get("approverMemberId") ?? undefined,
      q: params.get("q") ?? undefined,
    });
    return apiOk({ data: await listTeamTimesheets(context, query) });
  });
}
