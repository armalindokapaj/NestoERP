import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reverseAllocationSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { reverseContractAllocation } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ allocationId: string }> };

/** POST — reverses one allocation, with a reason; the row stays (E-05F §63, §81). Elevated. */
export async function POST(request: Request, { params }: Params) {
  const { allocationId } = await params;
  return withContext(async (context) => {
    const input = reverseAllocationSchema.parse(await readJson(request));
    await reverseContractAllocation(context, allocationId, input);
    return apiOk({ data: { ok: true } });
  });
}
