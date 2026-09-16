import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, amendmentId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    return apiOk({ data: await amendments.getAmendment(context, amendmentId) });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, amendmentId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    const input = amendmentSchema.parse(await readJson(request));
    return apiOk({ data: await amendments.updateAmendment(context, amendmentId, input) });
  });
}
