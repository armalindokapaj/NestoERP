import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createComplianceItem, listContractorCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { createComplianceSchema } from "@/lib/modules/contractors/contractor.schema";

type Params = { params: Promise<{ contractorId: string }> };

/** GET — insurance, licences, guarantees and certificates, with their expiry (PRD #46 §41-§48, §216). */
export async function GET(_request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await listContractorCompliance(context, contractorId) });
  });
}

/** POST — record a compliance item; its status follows its expiry (PRD #46 §41, §48, §216). */
export async function POST(request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createComplianceSchema.parse(await readJson(request));
    return apiOk({ data: await createComplianceItem(context, contractorId, input) }, { status: 201 });
  });
}
