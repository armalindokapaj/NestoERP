import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateInvoiceSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";

type Params = { params: Promise<{ invoiceId: string }> };

/**
 * GET   — one invoice, or 404 if it is outside scope (PRD #15 §174).
 * PATCH — edit a draft or rejected invoice. Status is not a field here: each
 *         transition has its own endpoint, so "update" can never move an
 *         invoice through approval (PRD #15 §219).
 */
export async function GET(_request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await invoices.getInvoice(context, invoiceId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    const input = updateInvoiceSchema.parse(await readJson(request));
    return apiOk({ data: await invoices.updateInvoice(context, invoiceId, input) });
  });
}
