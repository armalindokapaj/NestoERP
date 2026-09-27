import { withContext } from "@/lib/api/respond";
import { decisionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { readJson } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/expenses/expense.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ expenseId: string }> };

/** Approves a pending expense, recognising the cost (PRD #15 §98). */
export async function POST(request: Request, { params }: Params) {
  const { expenseId } = await params;
  return withContext(async (context) => {
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request).catch((): Record<string, unknown> => ({}));
    const input = decisionSchema.parse(body);
    await service.approveExpense(context, expenseId, input.note ?? null, approvalGuardFrom(body));
    return new Response(null, { status: 204 });
  });
}
