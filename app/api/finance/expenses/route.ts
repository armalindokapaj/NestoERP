import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { parseExpenseQuery } from "@/lib/modules/finance/finance.query";
import { createExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";

/** GET/POST /api/finance/expenses (PRD #15 §223). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await expenses.listExpenses(context, parseExpenseQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createExpenseSchema.parse(await readJson(request));
    return apiOk({ data: await expenses.createExpense(context, input) }, { status: 201 });
  });
}
