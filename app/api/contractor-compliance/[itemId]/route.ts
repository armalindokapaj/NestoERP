import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { updateComplianceItem } from "@/lib/modules/contractors/contractor.compliance";
import { updateComplianceSchema } from "@/lib/modules/contractors/contractor.schema";

type Params = { params: Promise<{ itemId: string }> };

/** PATCH — renew or correct an item; the status follows the new dates (PRD #46 §216, §312). */
export async function PATCH(request: Request, { params }: Params) {
  const { itemId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateComplianceSchema.parse(await readJson(request));
    return apiOk({ data: await updateComplianceItem(context, itemId, input) });
  });
}
