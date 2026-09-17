import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { allocatePaymentSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { allocateContractPayment } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ paymentId: string }> };

/** POST — allocates what is still unallocated on a sale contract's payment (E-05F §31, §34, §63). */
export async function POST(request: Request, { params }: Params) {
  const { paymentId } = await params;
  return withContext(async (context) => {
    const input = allocatePaymentSchema.parse(await readJson(request));
    return apiOk({ data: await allocateContractPayment(context, paymentId, input) });
  });
}
