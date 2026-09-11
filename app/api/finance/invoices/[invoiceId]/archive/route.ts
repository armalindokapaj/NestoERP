import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/invoices/invoice.service";

type Params = { params: Promise<{ invoiceId: string }> };

/** Archives a draft, rejected or cancelled invoice (PRD #15 §68). */
export async function POST(_request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    await service.archiveInvoice(context, invoiceId);
    return new Response(null, { status: 204 });
  });
}
