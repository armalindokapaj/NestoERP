import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { closeRfi } from "@/lib/modules/engineering/engineering.rfis";
import { closeRfiSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ rfiId: string }> };

/** POST — close an answered RFI (PRD #46 §219). */
export async function POST(request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = closeRfiSchema.parse(await readJson(request));
    return apiOk({ data: await closeRfi(context, rfiId, input) });
  });
}
