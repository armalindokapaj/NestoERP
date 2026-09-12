import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractReasonSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/**
 * PENDING_APPROVAL → IN_REVIEW, with a required reason (PRD #18 §114, §190).
 *
 * "Rejected" on its own tells whoever drafted it nothing they can act on.
 */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const { note } = contractReasonSchema.parse(await readJson(request));
    await contracts.rejectContract(context, contractId, note);
    return apiOk({ data: { ok: true } });
  });
}
