import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { parseBudgetQuery } from "@/lib/modules/finance/finance.query";
import { createBudgetSchema } from "@/lib/modules/finance/budgets/budget.schema";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";

/**
 * GET/POST /api/finance/budgets (PRD #15 §224). The GET answers the Group
 * workspace too: every company the caller may read, each row naming its company
 * and measured in its own currency, narrowed by `?company=` only within those
 * (Workspace Context §36, §86).
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const url = new URL(request.url);
      const query = parseBudgetQuery(url.searchParams);
      return apiOk(await budgets.listBudgetsForWorkspace(context, query, { company: url.searchParams.get("company") }));
    },
    { group: "read" },
  );
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createBudgetSchema.parse(await readJson(request));
    return apiOk({ data: await budgets.createBudget(context, input) }, { status: 201 });
  });
}
