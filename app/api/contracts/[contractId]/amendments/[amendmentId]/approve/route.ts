import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentNoteSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

/** PENDING_APPROVAL → APPROVED (PRD #18 §171). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, amendmentId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    const { note } = amendmentNoteSchema.parse(await readJson(request));
    await amendments.approveAmendment(context, amendmentId, note ?? null);
    return apiOk({ data: { ok: true } });
  });
}
