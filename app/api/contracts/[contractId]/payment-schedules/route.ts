import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createScheduleSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { createPaymentSchedule, listContractSchedules } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ contractId: string }> };

/** GET — every version of the sale contract's payment schedule, newest first (E-05F §59). */
export async function GET(_request: Request, { params }: Params) {
  const { contractId } = await params;
  return withContext(async (context) => apiOk({ data: await listContractSchedules(context, contractId) }));
}

/** POST — a draft schedule of installments; one draft per contract (E-05F §18-§23). */
export async function POST(request: Request, { params }: Params) {
  const { contractId } = await params;
  return withContext(async (context) => {
    const input = createScheduleSchema.parse(await readJson(request));
    return apiOk({ data: await createPaymentSchedule(context, contractId, input) }, { status: 201 });
  });
}
