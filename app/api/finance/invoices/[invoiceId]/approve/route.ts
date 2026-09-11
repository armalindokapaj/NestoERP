import { withContext } from "@/lib/api/respond";
import { decisionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { readJson } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/invoices/invoice.service";

type Params = { params: Promise<{ invoiceId: string }> };

/** Approves a pending invoice (PRD #15 §62). */
export async function POST(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(async (context) => {
    const input = decisionSchema.parse(await readJson(request).catch(() => ({})));
    await service.approveInvoice(context, invoiceId, input.note ?? null);
    return new Response(null, { status: 204 });
  });
}
