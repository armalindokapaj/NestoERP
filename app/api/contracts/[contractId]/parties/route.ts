import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractPartySchema } from "@/lib/modules/contracts/parties/party.schema";
import * as parties from "@/lib/modules/contracts/parties/party.service";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** The parties to an agreement (PRD #18 §262). */
export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    // Reaching the contract first is what makes the party list scoped.
    await contracts.getContract(context, contractId);
    return apiOk({ data: await parties.listParties(context, contractId) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const input = contractPartySchema.parse(await readJson(request));
    return apiOk({ data: await parties.addParty(context, contractId, input) }, { status: 201 });
  });
}
