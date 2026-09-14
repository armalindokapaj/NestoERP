import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { archiveComplianceItem } from "@/lib/modules/contractors/contractor.compliance";

type Params = { params: Promise<{ itemId: string }> };

/** POST — put an item away (PRD #46 §216). */
export async function POST(_request: Request, { params }: Params) {
  const { itemId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    return apiOk({ data: await archiveComplianceItem(context, itemId) });
  });
}
