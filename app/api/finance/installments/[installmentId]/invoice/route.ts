import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { issueInvoiceSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { issueInstallmentInvoice } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ installmentId: string }> };

/** POST — raises the draft invoice for one installment of the active schedule (E-05F §26, §61). */
export async function POST(request: Request, { params }: Params) {
  const { installmentId } = await params;
  return withContext(async (context) => {
    const input = issueInvoiceSchema.parse(await readJson(request));
    return apiOk({ data: await issueInstallmentInvoice(context, installmentId, input) }, { status: 201 });
  });
}
