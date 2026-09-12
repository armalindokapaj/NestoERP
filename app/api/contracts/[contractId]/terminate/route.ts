import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractTerminationSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** SIGNED or ACTIVE → TERMINATED, with a date and a reason (PRD #18 §130). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const input = contractTerminationSchema.parse(await readJson(request));
    await contracts.terminateContract(context, contractId, input);
    return apiOk({ data: { ok: true } });
  });
}
