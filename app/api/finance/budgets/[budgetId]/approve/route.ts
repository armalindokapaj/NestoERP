import { withContext } from "@/lib/api/respond";
import { decisionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { readJson } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/budgets/budget.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ budgetId: string }> };

/** Approves a budget and makes it the project's current one (PRD #15 §113). */
export async function POST(request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) => {
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request).catch((): Record<string, unknown> => ({}));
    const input = decisionSchema.parse(body);
    await service.approveBudget(context, budgetId, input.note ?? null, approvalGuardFrom(body));
    return new Response(null, { status: 204 });
  });
}
