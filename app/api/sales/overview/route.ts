import { apiOk, withContext } from "@/lib/api/respond";
import {
  attentionListForWorkspace,
  getSalesOverviewForWorkspace,
} from "@/lib/modules/sales/overview/overview.service";

/**
 * The module dashboard, scoped to the reader (PRD #17 §199, §413).
 *
 * In the Group workspace it is the same figures over every authorised company
 * (Workspace Context §37), money per currency; `?company=` narrows within them.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const companyId = new URL(request.url).searchParams.get("company") ?? undefined;
    const [overview, attention] = await Promise.all([
      getSalesOverviewForWorkspace(context, companyId),
      attentionListForWorkspace(context, companyId),
    ]);
    return apiOk({ data: { overview, attention } });
  }, { group: "read" });
}
