import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { voidRevision } from "@/lib/modules/engineering/engineering.revisions";

type Params = { params: Promise<{ revisionId: string }> };

/** POST — discard a draft revision (PRD #46 §103). */
export async function POST(_request: Request, { params }: Params) {
  const { revisionId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    return apiOk({ data: await voidRevision(context, "submittal", revisionId) });
  });
}
