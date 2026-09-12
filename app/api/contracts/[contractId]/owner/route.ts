import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractOwnerSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** Reassigns the internal record owner (PRD #18 §52, §323). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const { ownerMemberId } = contractOwnerSchema.parse(await readJson(request));
    await contracts.assignOwner(context, contractId, ownerMemberId);
    return apiOk({ data: { ok: true } });
  });
}
