import { withContext } from "@/lib/api/respond";
import { exportResponse, preparedFromText, recordExport } from "@/lib/core/export/exporter";
import { logger } from "@/lib/core/observability/logger";
import { assertExportParams } from "@/lib/core/export/export-params";
import { expenseCsv, EXPENSE_EXPORT_PARAMS } from "@/lib/modules/finance/finance.export";
import { parseExpenseQuery } from "@/lib/modules/finance/finance.query";
import { EXPORT_ROW_LIMIT, exportFilename } from "@/lib/modules/finance/finance.register";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";

/**
 * GET /api/finance/expenses/export — the expense register as CSV (AUD-01 §8; AUD-08 §7).
 *
 * The list's own query string and the list's own read, without the page: every
 * expense the filters match, in the list's order, from one snapshot (count,
 * totals and rows in one repeatable-read transaction). Needs `finance.export`
 * on top of the list's `finance.expense.view`, in every company the list
 * answers for — a Group view with one company that does not allow export is
 * refused whole (AUD-01 §7). Over 10,000 matches, or over the shared 10 MiB
 * byte cap, is refused with `EXPORT_LIMIT_EXCEEDED` and a JSON body, never cut
 * short and never served as a file.
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const startedAt = Date.now();
      const url = new URL(request.url);
      // A filter the register would drop is refused, not widened into every record (AUD-08 §3).
      assertExportParams(url.searchParams, EXPENSE_EXPORT_PARAMS);
      const query = parseExpenseQuery(url.searchParams);
      const { rows, evaluatedAt } = await expenses.exportExpensesForWorkspace(context, query, { company: url.searchParams.get("company") });
      const prepared = preparedFromText({
        filename: exportFilename("expenses", evaluatedAt),
        csv: expenseCsv(rows),
        rows,
        evaluatedAt,
        limits: { maxRows: EXPORT_ROW_LIMIT },
      });

      // Who took a copy, and of which register — not the rows or the filters (PRD #28 §130).
      await recordExport(context, { id: "finance-expenses", module: "finance", filename: prepared.filename });
      logger.info("finance.register_export", { register: "expenses", rows: rows.length, durationMs: Date.now() - startedAt });

      return exportResponse(prepared);
    },
    { group: "read" },
  );
}
