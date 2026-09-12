import { NextResponse } from "next/server";

import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractPartySchema } from "@/lib/modules/contracts/parties/party.schema";
import * as parties from "@/lib/modules/contracts/parties/party.service";

type Params = { params: Promise<{ contractId: string; partyId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, partyId } = await params;
    const input = contractPartySchema.parse(await readJson(request));
    return apiOk({ data: await parties.updateParty(context, contractId, partyId, input) });
  });
}

/** Removal is a draft-only action, and it is audited (PRD #18 §146, §262). */
export async function DELETE(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, partyId } = await params;
    await parties.removeParty(context, contractId, partyId);
    return new NextResponse(null, { status: 204 });
  });
}
