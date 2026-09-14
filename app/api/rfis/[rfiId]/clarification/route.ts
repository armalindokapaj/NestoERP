import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { requestClarification } from "@/lib/modules/engineering/engineering.rfis";
import { clarificationSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ rfiId: string }> };

/** POST — send an answered RFI back for clarification (PRD #46 §86, §219). */
export async function POST(request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = clarificationSchema.parse(await readJson(request));
    return apiOk({ data: await requestClarification(context, rfiId, input) });
  });
}
