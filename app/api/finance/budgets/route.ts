import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { parseBudgetQuery } from "@/lib/modules/finance/finance.query";
import { createBudgetSchema } from "@/lib/modules/finance/budgets/budget.schema";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";

/** GET/POST /api/finance/budgets (PRD #15 §224). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await budgets.listBudgets(context, parseBudgetQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createBudgetSchema.parse(await readJson(request));
    return apiOk({ data: await budgets.createBudget(context, input) }, { status: 201 });
  });
}
