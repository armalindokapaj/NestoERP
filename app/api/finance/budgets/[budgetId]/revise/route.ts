import { apiOk, withContext } from "@/lib/api/respond";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";

type Params = { params: Promise<{ budgetId: string }> };

/**
 * Opens the next budget version as a draft copy (PRD #15 §115).
 *
 * An approved budget is never edited in place — the revision is where the
 * change happens, and it goes through approval like any other version.
 */
export async function POST(_request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) => {
    const id = await budgets.reviseBudget(context, budgetId);
    return apiOk({ data: { id } }, { status: 201 });
  });
}
