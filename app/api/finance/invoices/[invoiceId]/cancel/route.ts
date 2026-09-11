import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/invoices/invoice.service";

type Params = { params: Promise<{ invoiceId: string }> };

/** Cancels an invoice that has taken no payment (PRD #15 §67). */
export async function POST(_request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    await service.cancelInvoice(context, invoiceId);
    return new Response(null, { status: 204 });
  });
}
