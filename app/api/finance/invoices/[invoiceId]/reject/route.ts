import { readJson, withContext } from "@/lib/api/respond";
import { rejectionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import * as service from "@/lib/modules/finance/invoices/invoice.service";
import { approvalGuardFrom } from "@/lib/core/approvals/approval-guard";

type Params = { params: Promise<{ invoiceId: string }> };

/** Rejects a pending invoice, with a reason (PRD #15 §63). */
export async function POST(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    // A rejection always says why: "rejected" with no reason is not feedback
    // anybody can act on (PRD #15 §146).
    // The cycle the caller decided, named by `approvalId` (AUD-10 §4, CW-02, CW-05).
    const body = await readJson(request);
    const input = rejectionSchema.parse(body);
    await service.rejectInvoice(context, invoiceId, input.note, approvalGuardFrom(body));
    return new Response(null, { status: 204 });
  });
}
