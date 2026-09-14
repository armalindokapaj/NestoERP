import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { updateContractorSchema } from "@/lib/modules/contractors/contractor.schema";
import { getContractor, updateContractor } from "@/lib/modules/contractors/contractor.service";

type Params = { params: Promise<{ contractorId: string }> };

/** GET — one contractor with its counts and what this reader may do (PRD #46 §164, §212). */
export async function GET(_request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await getContractor(context, contractorId) });
  });
}

/** PATCH — edit the contractor; archiving and reactivation have their own commands (PRD #46 §212). */
export async function PATCH(request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateContractorSchema.parse(await readJson(request));
    return apiOk({ data: await updateContractor(context, contractorId, input) });
  });
}
