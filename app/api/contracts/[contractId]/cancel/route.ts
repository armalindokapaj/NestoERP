import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractNoteSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** Stops a contract before it is signed (PRD #18 §128, §129). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const { note } = contractNoteSchema.parse(await readJson(request));
    await contracts.cancelContract(context, contractId, note ?? null);
    return apiOk({ data: { ok: true } });
  });
}
