import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { obligationCloseSchema } from "@/lib/modules/contracts/obligations/obligation.schema";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";

type Params = { params: Promise<{ contractId: string; obligationId: string }> };

/** The requirement has been met (PRD #18 §156). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, obligationId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await obligations.assertObligationOnContract(context, contractId, obligationId);
    const { note } = obligationCloseSchema.parse(await readJson(request));
    await obligations.completeObligation(context, obligationId, note ?? null);
    return apiOk({ data: { ok: true } });
  });
}
