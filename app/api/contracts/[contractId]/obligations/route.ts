import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { obligationSchema } from "@/lib/modules/contracts/obligations/obligation.schema";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** The obligations a contract creates (PRD #18 §263). */
export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.getContract(context, contractId);
    return apiOk({ data: await obligations.listForContract(context, contractId) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const input = obligationSchema.parse(await readJson(request));
    return apiOk(
      { data: await obligations.createObligation(context, contractId, input) },
      { status: 201 },
    );
  });
}
