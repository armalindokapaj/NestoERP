import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { decideRevision } from "@/lib/modules/engineering/engineering.revisions";
import { reviewDecisionSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ revisionId: string }> };

/** POST — record the review decision — authority and self-review checked here (PRD #46 §172, §250, §251). */
export async function POST(request: Request, { params }: Params) {
  const { revisionId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = reviewDecisionSchema.parse(await readJson(request));
    return apiOk({ data: await decideRevision(context, "submittal", revisionId, input) });
  });
}
