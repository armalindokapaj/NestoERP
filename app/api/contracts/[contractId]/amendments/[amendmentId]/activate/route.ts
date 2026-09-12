import { apiOk, withContext } from "@/lib/api/respond";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ amendmentId: string }> };

/** SIGNED → ACTIVE, applying the new value and expiry once (PRD #18 §174). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { amendmentId } = await params;
    await amendments.activateAmendment(context, amendmentId);
    return apiOk({ data: { ok: true } });
  });
}
