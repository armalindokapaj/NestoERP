import { withContext } from "@/lib/api/respond";
import { decisionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { readJson } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/budgets/budget.service";

type Params = { params: Promise<{ budgetId: string }> };

/** Approves a budget and makes it the project's current one (PRD #15 §113). */
export async function POST(request: Request, { params }: Params) {
  const { budgetId } = await params;
  return withContext(async (context) => {
    const input = decisionSchema.parse(await readJson(request).catch(() => ({})));
    await service.approveBudget(context, budgetId, input.note ?? null);
    return new Response(null, { status: 204 });
  });
}
