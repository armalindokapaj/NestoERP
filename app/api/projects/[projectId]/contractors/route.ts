import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createAssignment, listProjectAssignments } from "@/lib/modules/contractors/contractor.assignments";
import { createAssignmentSchema } from "@/lib/modules/contractors/contractor.schema";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the contractors on this project (PRD #46 §161, §214). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await listProjectAssignments(context, projectId) });
  });
}

/** POST — assign a contractor to this project (PRD #46 §25-§30, §214). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createAssignmentSchema.parse(await readJson(request));
    return apiOk({ data: await createAssignment(context, projectId, input) }, { status: 201 });
  });
}
