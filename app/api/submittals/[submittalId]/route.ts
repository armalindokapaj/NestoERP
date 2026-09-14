import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { updateSubmittalSchema } from "@/lib/modules/engineering/engineering.schema";
import { getSubmittal, updateSubmittal } from "@/lib/modules/engineering/engineering.submittals";

type Params = { params: Promise<{ submittalId: string }> };

/** GET — one submittal with its revisions, reviews and links (PRD #46 §220). */
export async function GET(_request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await getSubmittal(context, submittalId) });
  });
}

/** PATCH — edit its details and reviewer — never its status (PRD #46 §220, §252). */
export async function PATCH(request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateSubmittalSchema.parse(await readJson(request));
    return apiOk({ data: await updateSubmittal(context, submittalId, input) });
  });
}
