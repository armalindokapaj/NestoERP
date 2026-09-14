import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { respondRfi } from "@/lib/modules/engineering/engineering.rfis";
import { respondRfiSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ rfiId: string }> };

/** POST — add a response — never an edit of one (PRD #46 §89, §90, §219). */
export async function POST(request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = respondRfiSchema.parse(await readJson(request));
    return apiOk({ data: await respondRfi(context, rfiId, input) });
  });
}
