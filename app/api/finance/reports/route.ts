import { inGroupWorkspace } from "@/config/workspace";
import { apiError, apiOk, withContext } from "@/lib/api/respond";
import * as reports from "@/lib/modules/finance/reports/reports.service";

/**
 * The built-in reports (PRD #15 §226, §148).
 *
 * One endpoint with a named report rather than six: every report runs the same
 * scope clauses the lists do, and there is no report-only query path
 * (PRD #15 §158, §270).
 *
 * In the Group workspace each report is every company the caller may read the
 * report in, as that company's own report: `data` holds `rows` — each naming
 * its company — and `totals`, added only within a currency (Workspace Context
 * §41, §72). A company the caller cannot read is in neither.
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const url = new URL(request.url);
      const report = url.searchParams.get("report") ?? "receivables-aging";
      const group = inGroupWorkspace(context);

      switch (report) {
        case "receivables-aging":
          return apiOk({ data: group ? await reports.receivablesAgingAcross(context) : await reports.receivablesAging(context) });

        case "budget-vs-actual":
          return apiOk({ data: group ? await reports.budgetVsActualAcross(context) : await reports.budgetVsActual(context) });

        case "expenses-by-category": {
          const options = { projectId: url.searchParams.get("projectId") ?? undefined };
          return apiOk({
            data: group ? await reports.expensesByCategoryAcross(context, options) : await reports.expensesByCategory(context, options),
          });
        }

        case "cashflow": {
          const period = url.searchParams.get("period") ?? "this-month";
          const known = (reports.CASHFLOW_PERIODS as readonly string[]).includes(period);
          const selected = known ? (period as reports.CashflowPeriod) : "this-month";
          return apiOk({
            data: group ? await reports.cashflowSummaryAcross(context, selected) : await reports.cashflowSummary(context, selected),
          });
        }

        case "commitment-summary":
          return apiOk({ data: group ? await reports.commitmentSummaryAcross(context) : await reports.commitmentSummary(context) });

        default:
          return apiError("VALIDATION_ERROR", "That report does not exist.");
      }
    },
    { group: "read" },
  );
}
