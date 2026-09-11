import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/expenses/expense.service";

type Params = { params: Promise<{ expenseId: string }> };

/** Cancels an expense that has taken no payment (PRD #15 §101). */
export async function POST(_request: Request, { params }: Params) {
  const { expenseId } = await params;
  return withContext(async (context) => {
    await service.cancelExpense(context, expenseId);
    return new Response(null, { status: 204 });
  });
}
