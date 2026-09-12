import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** The amendment history of one contract (PRD #18 §264). */
export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.getContract(context, contractId);
    return apiOk({ data: await amendments.listForContract(context, contractId) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const input = amendmentSchema.parse(await readJson(request));
    return apiOk(
      { data: await amendments.createAmendment(context, contractId, input) },
      { status: 201 },
    );
  });
}
