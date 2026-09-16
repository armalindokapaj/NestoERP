import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentSignedSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ contractId: string; amendmentId: string }> };

/** SENT → SIGNED, with the date it was signed (PRD #18 §173). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId, amendmentId } = await params;
    // The child must belong to the contract in the path (PRD #47 §17).
    await amendments.assertAmendmentOnContract(context, contractId, amendmentId);
    const input = amendmentSignedSchema.parse(await readJson(request));
    await amendments.markAmendmentSigned(context, amendmentId, input);
    return apiOk({ data: { ok: true } });
  });
}
