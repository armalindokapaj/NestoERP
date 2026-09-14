import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { reactivateContractorSchema } from "@/lib/modules/contractors/contractor.schema";
import { reactivateContractor } from "@/lib/modules/contractors/contractor.service";

type Params = { params: Promise<{ contractorId: string }> };

/** POST — bring an offboarded or archived contractor back, with a reason (PRD #46 §19, §212). */
export async function POST(request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = reactivateContractorSchema.parse(await readJson(request));
    return apiOk({ data: await reactivateContractor(context, contractorId, input) });
  });
}
