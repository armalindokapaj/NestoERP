import { apiOk, withContext } from "@/lib/api/respond";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ amendmentId: string }> };

/** DRAFT or REJECTED → PENDING_APPROVAL (PRD #18 §170). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { amendmentId } = await params;
    await amendments.submitAmendment(context, amendmentId);
    return apiOk({ data: { ok: true } });
  });
}
