import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { updateAssignment } from "@/lib/modules/contractors/contractor.assignments";
import { updateAssignmentSchema } from "@/lib/modules/contractors/contractor.schema";

type Params = { params: Promise<{ assignmentId: string }> };

/** PATCH — change an assignment's status, contract, manager, contact or dates (PRD #46 §214). */
export async function PATCH(request: Request, { params }: Params) {
  const { assignmentId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateAssignmentSchema.parse(await readJson(request));
    return apiOk({ data: await updateAssignment(context, assignmentId, input) });
  });
}
