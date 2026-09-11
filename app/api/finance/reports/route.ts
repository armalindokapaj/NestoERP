import { apiError, apiOk, withContext } from "@/lib/api/respond";
import * as reports from "@/lib/modules/finance/reports/reports.service";

/**
 * The built-in reports (PRD #15 §226, §148).
 *
 * One endpoint with a named report rather than six: every report runs the same
 * scope clauses the lists do, and there is no report-only query path
 * (PRD #15 §158, §270).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const report = url.searchParams.get("report") ?? "receivables-aging";

    switch (report) {
      case "receivables-aging":
        return apiOk({ data: await reports.receivablesAging(context) });

      case "budget-vs-actual":
        return apiOk({ data: await reports.budgetVsActual(context) });

      case "expenses-by-category":
        return apiOk({
          data: await reports.expensesByCategory(context, {
            projectId: url.searchParams.get("projectId") ?? undefined,
          }),
        });

      case "cashflow": {
        const period = url.searchParams.get("period") ?? "this-month";
        const known = (reports.CASHFLOW_PERIODS as readonly string[]).includes(period);
        return apiOk({
          data: await reports.cashflowSummary(
            context,
            known ? (period as reports.CashflowPeriod) : "this-month",
          ),
        });
      }

      case "commitment-summary":
        return apiOk({ data: await reports.commitmentSummary(context) });

      default:
        return apiError("VALIDATION_ERROR", "That report does not exist.");
    }
  });
}
