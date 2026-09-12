import { apiOk, withContext } from "@/lib/api/respond";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** Hides a finished contract from the working lists (PRD #18 §134). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.archiveContract(context, contractId);
    return apiOk({ data: { ok: true } });
  });
}
