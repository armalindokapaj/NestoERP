import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { openRfi } from "@/lib/modules/engineering/engineering.rfis";

type Params = { params: Promise<{ rfiId: string }> };

/** POST — open a draft RFI (PRD #46 §86, §219). */
export async function POST(_request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    return apiOk({ data: await openRfi(context, rfiId) });
  });
}
