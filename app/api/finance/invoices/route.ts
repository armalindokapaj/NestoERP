import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { parseInvoiceQuery } from "@/lib/modules/finance/finance.query";
import { createInvoiceSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";

/**
 * GET  /api/finance/invoices — scoped, filtered, paginated (PRD #15 §221). In the
 *      Group workspace: the invoices of every company the caller may read, each
 *      naming its company, narrowed by `?company=` only within those (§36, §86).
 *      Every filter, settlement included, applies before the page; `summary`
 *      beside `data` and `pagination` totals all the matches per currency, and
 *      `pagination.page` is the page actually read (AUD-01 §5, §6).
 * POST /api/finance/invoices — create a draft, requiring finance.invoice.create.
 *
 * Totals are absent from the request body: the server calculates them from the
 * lines, so there is nothing here for a caller to inflate (PRD #15 §220).
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const url = new URL(request.url);
      const query = parseInvoiceQuery(url.searchParams);
      return apiOk(await invoices.listInvoicesForWorkspace(context, query, { company: url.searchParams.get("company") }));
    },
    { group: "read" },
  );
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createInvoiceSchema.parse(await readJson(request));
    return apiOk({ data: await invoices.createInvoice(context, input) }, { status: 201 });
  });
}
