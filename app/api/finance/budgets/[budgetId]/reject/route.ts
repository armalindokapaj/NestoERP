import { readJson, withContext } from "@/lib/api/respond";
import { rejectionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import * as service from "@/lib/modules/finance/budgets/budget.service";

type Params = { params: Promise<{ budgetId: string }> };

/** Rejects a pending budget, with a reason (PRD #15 §114). */
export async function POST(request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) => {
    // A rejection always says why: "rejected" with no reason is not feedback
    // anybody can act on (PRD #15 §146).
    const input = rejectionSchema.parse(await readJson(request));
    await service.rejectBudget(context, budgetId, input.note);
    return new Response(null, { status: 204 });
  });
}
