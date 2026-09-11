import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";

type Params = { params: Promise<{ expenseId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { expenseId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await expenses.getExpense(context, expenseId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { expenseId } = await params;
  return withContext(async (context) => {
    const input = updateExpenseSchema.parse(await readJson(request));
    return apiOk({ data: await expenses.updateExpense(context, expenseId, input) });
  });
}
