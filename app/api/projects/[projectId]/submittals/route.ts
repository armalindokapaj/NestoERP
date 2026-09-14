import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createSubmittalSchema, submittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { createSubmittal, listSubmittals } from "@/lib/modules/engineering/engineering.submittals";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's submittal register (PRD #46 §168, §220). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const query = submittalListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listSubmittals(context, { ...query, projectId }) });
  });
}

/** POST — register a submittal (PRD #46 §99, §220). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createSubmittalSchema.parse(await readJson(request));
    return apiOk({ data: await createSubmittal(context, projectId, input) }, { status: 201 });
  });
}
