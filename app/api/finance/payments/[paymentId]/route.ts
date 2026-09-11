import { apiOk, withContext } from "@/lib/api/respond";
import * as payments from "@/lib/modules/finance/payments/payment.service";

type Params = { params: Promise<{ paymentId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { paymentId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await payments.getPayment(context, paymentId) }),
  );
}
