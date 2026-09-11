import { readJson, withContext } from "@/lib/api/respond";
import { voidPaymentSchema } from "@/lib/modules/finance/payments/payment.schema";
import * as payments from "@/lib/modules/finance/payments/payment.service";

type Params = { params: Promise<{ paymentId: string }> };

/**
 * Voids a recorded payment (PRD #15 §85).
 *
 * There is no DELETE. A payment that was recorded and then reversed is a fact
 * about the company's money, and the reason it was reversed is part of it.
 */
export async function POST(request: Request, { params }: Params) {
  const { paymentId } = await params;
  return withContext(async (context) => {
    const input = voidPaymentSchema.parse(await readJson(request));
    await payments.voidPayment(context, paymentId, input.reason);
    return new Response(null, { status: 204 });
  });
}
