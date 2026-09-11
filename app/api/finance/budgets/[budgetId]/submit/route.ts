import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/budgets/budget.service";

type Params = { params: Promise<{ budgetId: string }> };

/** Submits a draft or rejected budget for approval (PRD #15 §112). */
export async function POST(_request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) => {
    await service.submitBudget(context, budgetId);
    return new Response(null, { status: 204 });
  });
}
