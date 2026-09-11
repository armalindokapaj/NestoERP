import { apiOk, withContext } from "@/lib/api/respond";
import { getHrOverview } from "@/lib/modules/hr/overview/overview.service";

/** The HR module dashboard (PRD #16 §21). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getHrOverview(context) }));
}
