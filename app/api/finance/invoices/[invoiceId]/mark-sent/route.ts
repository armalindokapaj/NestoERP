import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/invoices/invoice.service";

type Params = { params: Promise<{ invoiceId: string }> };

/** Records that an approved invoice has been sent (PRD #15 §65). */
export async function POST(_request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    await service.markInvoiceSent(context, invoiceId);
    return new Response(null, { status: 204 });
  });
}
