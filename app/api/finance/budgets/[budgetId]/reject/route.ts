import { readJson, withContext } from "@/lib/api/respond";
import { rejectionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import * as service from "@/lib/modules/finance/budgets/budget.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ budgetId: string }> };

/** Rejects a pending budget, with a reason (PRD #15 §114). */
export async function POST(request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) => {
    // A rejection always says why: "rejected" with no reason is not feedback
    // anybody can act on (PRD #15 §146).
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request);
    const input = rejectionSchema.parse(body);
    await service.rejectBudget(context, budgetId, input.note, approvalGuardFrom(body));
    return new Response(null, { status: 204 });
  });
}
