import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { parsePaymentQuery } from "@/lib/modules/finance/finance.query";
import { createPaymentSchema } from "@/lib/modules/finance/payments/payment.schema";
import * as payments from "@/lib/modules/finance/payments/payment.service";

/**
 * GET  /api/finance/payments (PRD #15 §222).
 * POST /api/finance/payments — record a receipt or a disbursement.
 *
 * The currency is absent from the body: it is inherited from the record being
 * settled, so a caller cannot pay a euro invoice in dollars (PRD #15 §76).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await payments.listPayments(context, parsePaymentQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createPaymentSchema.parse(await readJson(request));
    const id = await payments.recordPayment(context, input);
    return apiOk({ data: await payments.getPayment(context, id) }, { status: 201 });
  });
}
