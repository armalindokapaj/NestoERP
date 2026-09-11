import { withContext } from "@/lib/api/respond";
import { decisionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { readJson } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/expenses/expense.service";

type Params = { params: Promise<{ expenseId: string }> };

/** Approves a pending expense, recognising the cost (PRD #15 §98). */
export async function POST(request: Request, { params }: Params) {
  const { expenseId } = await params;
  return withContext(async (context) => {
    const input = decisionSchema.parse(await readJson(request).catch(() => ({})));
    await service.approveExpense(context, expenseId, input.note ?? null);
    return new Response(null, { status: 204 });
  });
}
