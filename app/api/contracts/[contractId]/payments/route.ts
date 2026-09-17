import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { recordContractPaymentSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { recordContractPayment } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ contractId: string }> };

/** POST — money received against a sale contract, allocated to its installments in the same transaction (E-05F §62, §77). */
export async function POST(request: Request, { params }: Params) {
  const { contractId } = await params;
  return withContext(async (context) => {
    const input = recordContractPaymentSchema.parse(await readJson(request));
    return apiOk({ data: await recordContractPayment(context, contractId, input) }, { status: 201 });
  });
}
