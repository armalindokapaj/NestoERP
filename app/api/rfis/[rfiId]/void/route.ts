import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { voidRfi } from "@/lib/modules/engineering/engineering.rfis";
import { voidSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ rfiId: string }> };

/** POST — void an RFI, with a reason (PRD #46 §219). */
export async function POST(request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = voidSchema.parse(await readJson(request));
    return apiOk({ data: await voidRfi(context, rfiId, input) });
  });
}
