import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/expenses/expense.service";

type Params = { params: Promise<{ expenseId: string }> };

/** Archives a draft, rejected or cancelled expense (PRD #15 §102). */
export async function POST(_request: Request, { params }: Params) {
  const { expenseId } = await params;
  return withContext(async (context) => {
    await service.archiveExpense(context, expenseId);
    return new Response(null, { status: 204 });
  });
}
