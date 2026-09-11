import { apiOk, withContext } from "@/lib/api/respond";
import { getProjectFinanceSummary } from "@/lib/modules/finance/budgets/budget.service";

type Params = { params: Promise<{ projectId: string }> };

/**
 * One project's finance summary (PRD #15 §258, §259).
 *
 * The same service the Finance module and the budget report call, so a project
 * can never show one variance here and a different one there.
 */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await getProjectFinanceSummary(context, projectId) }),
  );
}
