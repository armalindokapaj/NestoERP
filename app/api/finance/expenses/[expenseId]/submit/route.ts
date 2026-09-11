import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/expenses/expense.service";

type Params = { params: Promise<{ expenseId: string }> };

/** Submits a draft or rejected expense for approval (PRD #15 §97). */
export async function POST(_request: Request, { params }: Params) {
  const { expenseId } = await params;
  return withContext(async (context) => {
    await service.submitExpense(context, expenseId);
    return new Response(null, { status: 204 });
  });
}
