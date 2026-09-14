import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createPhase } from "@/lib/modules/project-planning/planning.phases";
import { createPhaseSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ projectId: string }> };

/** POST — add a phase to the end of the plan (PRD #44 §187). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createPhaseSchema.parse(await readJson(request));
    return apiOk({ data: await createPhase(context, projectId, input) }, { status: 201 });
  });
}
