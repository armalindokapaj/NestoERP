import { apiOk, withContext } from "@/lib/api/respond";
import { getFinanceOverview } from "@/lib/modules/finance/overview/overview.service";

/** The Finance module dashboard, grouped by currency (PRD #15 §226). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getFinanceOverview(context) }));
}
