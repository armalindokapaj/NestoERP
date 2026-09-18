import { apiOk, withContext } from "@/lib/api/respond";
import { getGroupDashboard } from "@/lib/modules/dashboard/dashboard.group";

/**
 * GET /api/dashboard/group — the group's executive view in one response
 * (D-01 §79): identity, figures, companies, key projects, portfolio, types,
 * departments, milestones and activity, each computed company by company as the
 * reader. Only for those who see the group as a group (§66).
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getGroupDashboard(context) }));
}
