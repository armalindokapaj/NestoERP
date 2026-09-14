import { apiOk, withContext } from "@/lib/api/respond";
import { planningReport } from "@/lib/modules/project-planning/planning.reports";
import { reportQuerySchema } from "@/lib/modules/project-planning/planning.schema";

/** GET /api/project-planning/reports — milestones by status, project and phase, overdue, variance, critical and portfolio (PRD #44 §171-§175, §255). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const search = new URL(request.url).searchParams;
    const query = reportQuerySchema.parse(Object.fromEntries(["projectId", "phaseId", "status", "ownerId", "critical", "from", "to"].flatMap((key) => (search.get(key) ? [[key, search.get(key)]] : []))));
    return apiOk({ data: await planningReport(context, query) });
  });
}
