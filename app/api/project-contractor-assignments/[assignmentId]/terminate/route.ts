import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { terminateAssignment } from "@/lib/modules/contractors/contractor.assignments";
import { terminateAssignmentSchema } from "@/lib/modules/contractors/contractor.schema";

type Params = { params: Promise<{ assignmentId: string }> };

/** POST — end the assignment, keep its history, stop new work (PRD #46 §31, §214). */
export async function POST(request: Request, { params }: Params) {
  const { assignmentId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = terminateAssignmentSchema.parse(await readJson(request));
    return apiOk({ data: await terminateAssignment(context, assignmentId, input) });
  });
}
