import { readJson, withContext } from "@/lib/api/respond";
import { rejectionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import * as service from "@/lib/modules/finance/invoices/invoice.service";

type Params = { params: Promise<{ invoiceId: string }> };

/** Rejects a pending invoice, with a reason (PRD #15 §63). */
export async function POST(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    // A rejection always says why: "rejected" with no reason is not feedback
    // anybody can act on (PRD #15 §146).
    const input = rejectionSchema.parse(await readJson(request));
    await service.rejectInvoice(context, invoiceId, input.note);
    return new Response(null, { status: 204 });
  });
}
