import { apiOk, withContext } from "@/lib/api/respond";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** Returns an archived contract to the status it held (PRD #18 §135). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.restoreContract(context, contractId);
    return apiOk({ data: { ok: true } });
  });
}
