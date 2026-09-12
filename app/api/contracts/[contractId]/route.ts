import { apiOk, readJson, withContext } from "@/lib/api/respond";
import {
  updateContractMetadataSchema,
  updateContractSchema,
} from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/**
 * GET   /api/contracts/:id  — the full record, redacted for the reader.
 * PATCH /api/contracts/:id  — edit.
 *
 * The body decides which edit this is: a full body edits the terms and is
 * refused once the contract is approved; a body with only owner and summary is
 * the correction an approved contract still allows (PRD #18 §106, §107).
 */
export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    return apiOk({ data: await contracts.getContract(context, contractId) });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const body = await readJson(request);

    if (body.contractNumber === undefined) {
      const input = updateContractMetadataSchema.parse(body);
      return apiOk({ data: await contracts.updateContractMetadata(context, contractId, input) });
    }

    const input = updateContractSchema.parse(body);
    return apiOk({ data: await contracts.updateContract(context, contractId, input) });
  });
}
