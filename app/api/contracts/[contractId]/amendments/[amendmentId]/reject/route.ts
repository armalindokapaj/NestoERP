import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentReasonSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

/** PENDING_APPROVAL → REJECTED, with a required reason (PRD #18 §190). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, amendmentId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    const { note } = amendmentReasonSchema.parse(await readJson(request));
    await amendments.rejectAmendment(context, amendmentId, note);
    return apiOk({ data: { ok: true } });
  });
}
