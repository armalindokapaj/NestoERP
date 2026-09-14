import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { closeSubmittal } from "@/lib/modules/engineering/engineering.submittals";

type Params = { params: Promise<{ submittalId: string }> };

/** POST — close out a decided submittal (PRD #46 §227). */
export async function POST(_request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    return apiOk({ data: await closeSubmittal(context, submittalId) });
  });
}
