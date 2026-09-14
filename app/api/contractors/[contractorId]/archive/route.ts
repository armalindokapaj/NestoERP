import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { archiveContractorSchema } from "@/lib/modules/contractors/contractor.schema";
import { archiveContractor } from "@/lib/modules/contractors/contractor.service";

type Params = { params: Promise<{ contractorId: string }> };

/** POST — offboard or archive — history is kept, nothing is deleted (PRD #46 §18, §212). */
export async function POST(request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = archiveContractorSchema.parse(await readJson(request));
    return apiOk({ data: await archiveContractor(context, contractorId, input) });
  });
}
