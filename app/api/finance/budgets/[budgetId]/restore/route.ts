import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/budgets/budget.service";

type Params = { params: Promise<{ budgetId: string }> };

/** Returns an archived budget to the status it held (PRD #15 §116). */
export async function POST(_request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) => {
    await service.restoreBudget(context, budgetId);
    return new Response(null, { status: 204 });
  });
}
