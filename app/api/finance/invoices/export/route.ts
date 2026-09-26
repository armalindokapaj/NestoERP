import { withContext } from "@/lib/api/respond";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { logger } from "@/lib/core/observability/logger";
import { invoiceCsv } from "@/lib/modules/finance/finance.export";
import { parseInvoiceQuery } from "@/lib/modules/finance/finance.query";
import { exportFilename } from "@/lib/modules/finance/finance.register";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";

/**
 * GET /api/finance/invoices/export — the invoice register as CSV (AUD-01 §8).
 *
 * The list's own query string and the list's own read, without the page: every
 * invoice the filters match, in the list's order, from one snapshot. Needs
 * `finance.export` on top of the list's `finance.invoice.view`, in every company
 * the list answers for — a Group view with one company that does not allow
 * export is refused whole (AUD-01 §7). Over 10,000 matches is refused with
 * `EXPORT_LIMIT_EXCEEDED`, never cut short.
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const startedAt = Date.now();
      const url = new URL(request.url);
      const query = parseInvoiceQuery(url.searchParams);
      const { rows, evaluatedAt } = await invoices.exportInvoicesForWorkspace(context, query, { company: url.searchParams.get("company") });
      const filename = exportFilename("invoices", evaluatedAt);

      // Who took a copy, and of which register — not the rows or the filters (PRD #28 §130).
      await recordUserAction(context, {
        actionKey: AuditAction.REPORT_EXPORTED_CSV,
        entity: { type: "export", id: "finance-invoices", label: filename },
        metadata: { module: "finance" },
      });
      logger.info("finance.register_export", { register: "invoices", rows: rows.length, durationMs: Date.now() - startedAt });

      return new Response(invoiceCsv(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          // Scoped financial data: never kept by a shared cache (PRD #30 §214).
          "Cache-Control": "private, no-store",
          "X-Export-Row-Count": String(rows.length),
          "X-Export-Evaluated-At": evaluatedAt.toISOString(),
        },
      });
    },
    { group: "read" },
  );
}
