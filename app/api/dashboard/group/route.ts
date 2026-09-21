import { apiOk, withContext } from "@/lib/api/respond";
import { getGroupDashboard } from "@/lib/modules/dashboard/dashboard.group";

/**
 * GET /api/dashboard/group — the group's executive view in one response
 * (D-01 §79): identity, figures, companies, key projects, portfolio, types,
 * departments, milestones and activity, each computed company by company as the
 * reader. Only in the Group workspace, for somebody with group-level standing:
 * from a company workspace it is refused with nothing about the group (§66;
 * Workspace Context §18).
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getGroupDashboard(context) }), { group: "read" });
}
