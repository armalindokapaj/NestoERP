import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/invoices/invoice.service";

type Params = { params: Promise<{ invoiceId: string }> };

/** Submits a draft or rejected invoice for approval (PRD #15 §61). */
export async function POST(_request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    await service.submitInvoice(context, invoiceId);
    return new Response(null, { status: 204 });
  });
}
