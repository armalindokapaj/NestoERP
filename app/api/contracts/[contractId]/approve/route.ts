import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contractNoteSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/** PENDING_APPROVAL → APPROVED (PRD #18 §113). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    const { note } = contractNoteSchema.parse(await readJson(request));
    await contracts.approveContract(context, contractId, note ?? null);
    return apiOk({ data: { ok: true } });
  });
}
