import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractSignedSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** SENT → SIGNED, with the date it was signed (PRD #18 §118, §119). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const input = contractSignedSchema.parse(await readJson(request));
    await contracts.markSigned(context, contractId, input);
    return apiOk({ data: { ok: true } });
  });
}
