import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { contractorListSchema, createContractorSchema } from "@/lib/modules/contractors/contractor.schema";
import { createContractor, listContractors } from "@/lib/modules/contractors/contractor.service";

/** GET — the contractor directory, with each contractor's projects, open RFIs, submittals and compliance alerts (PRD #46 §163, §212). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const query = contractorListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listContractors(context, query) });
  });
}

/** POST — add a contractor; a likely duplicate is refused until the writer confirms it (PRD #46 §16, §17, §212). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createContractorSchema.parse(await readJson(request));
    return apiOk({ data: await createContractor(context, input) }, { status: 201 });
  });
}
