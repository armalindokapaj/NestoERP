import { apiOk, withContext } from "@/lib/api/respond";
import { getAccessPortfolio } from "@/lib/modules/organization/access-portfolio.service";

/**
 * GET /api/me/access-portfolio — the companies, department positions, projects
 * and delegated access this person works with across their group (E-06 §16, §95).
 */
export async function GET() {
  return withContext(async (session) => apiOk({ data: await getAccessPortfolio(session) }));
}
