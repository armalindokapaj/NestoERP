import { apiOk, withContext } from "@/lib/api/respond";
import { getFinanceOverviewForWorkspace } from "@/lib/modules/finance/overview/overview.service";

/**
 * The Finance module dashboard, grouped by currency (PRD #15 §226). In the
 * Group workspace it is each readable company's overview and the per-currency
 * totals across them (Workspace Context §36, §72); it says `scope: "GROUP"`.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getFinanceOverviewForWorkspace(context) }), { group: "read" });
}
