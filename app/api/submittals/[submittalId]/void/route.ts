import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { voidSchema } from "@/lib/modules/engineering/engineering.schema";
import { voidSubmittal } from "@/lib/modules/engineering/engineering.submittals";

type Params = { params: Promise<{ submittalId: string }> };

/** POST — void a submittal, with a reason (PRD #46 §101). */
export async function POST(request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = voidSchema.parse(await readJson(request));
    return apiOk({ data: await voidSubmittal(context, submittalId, input) });
  });
}
