import { apiOk, withContext } from "@/lib/api/respond";
import { portfolioFilterOptions } from "@/lib/modules/projects/project.portfolio";

/**
 * GET /api/projects/filter-options — companies, roles, types and places, each
 * drawn only from projects this person can see (E-05A §41).
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await portfolioFilterOptions(context) }), { group: "read" });
}
