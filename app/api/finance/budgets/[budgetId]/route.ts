import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateBudgetSchema } from "@/lib/modules/finance/budgets/budget.schema";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";

type Params = { params: Promise<{ budgetId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await budgets.getBudget(context, budgetId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) => {
    const input = updateBudgetSchema.parse(await readJson(request));
    return apiOk({ data: await budgets.updateBudget(context, budgetId, input) });
  });
}
