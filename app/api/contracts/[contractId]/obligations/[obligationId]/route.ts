import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { obligationSchema } from "@/lib/modules/contracts/obligations/obligation.schema";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";

type Params = { params: Promise<{ contractId: string; obligationId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, obligationId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await obligations.assertObligationOnContract(context, contractId, obligationId);
    return apiOk({ data: await obligations.getObligation(context, obligationId) });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, obligationId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await obligations.assertObligationOnContract(context, contractId, obligationId);
    const input = obligationSchema.parse(await readJson(request));
    return apiOk({ data: await obligations.updateObligation(context, obligationId, input) });
  });
}
