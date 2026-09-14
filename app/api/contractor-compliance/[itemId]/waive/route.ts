import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { waiveComplianceItem } from "@/lib/modules/contractors/contractor.compliance";
import { waiveComplianceSchema } from "@/lib/modules/contractors/contractor.schema";

type Params = { params: Promise<{ itemId: string }> };

/** POST — waive a requirement — its own permission and a reason (PRD #46 §49, §216). */
export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = waiveComplianceSchema.parse(await readJson(request));
    return apiOk({ data: await waiveComplianceItem(context, itemId, input) });
  });
}
