import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/invoices/invoice.service";

type Params = { params: Promise<{ invoiceId: string }> };

/** Returns an archived invoice to the status it held (PRD #15 §69). */
export async function POST(_request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    await service.restoreInvoice(context, invoiceId);
    return new Response(null, { status: 204 });
  });
}
