import { apiOk, withContext } from "@/lib/api/respond";
import { getPipelineForWorkspace } from "@/lib/modules/sales/opportunities/pipeline.service";

/**
 * The Kanban board's data, in two queries rather than one per column (§247).
 *
 * In the Group workspace it is one board over every authorised company
 * (Workspace Context §37), totals per currency; `?company=` narrows within them.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const companyId = new URL(request.url).searchParams.get("company") ?? undefined;
    return apiOk({ data: await getPipelineForWorkspace(context, companyId) });
  }, { group: "read" });
}
