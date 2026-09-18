import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { endProjectAssignment } from "@/lib/modules/workforce/assignment.service";
import { endAssignmentSchema } from "@/lib/modules/workforce/workforce.schema";

type Params = { params: Promise<{ employeeId: string; assignmentId: string }> };

/** POST /api/workforce/employees/:employeeId/project-assignments/:assignmentId/end — off the project after a last day (E-04 §160). */
export async function POST(request: Request, { params }: Params) {
  const { employeeId, assignmentId } = await params;
  return withContext(async (context) => {
    const input = endAssignmentSchema.parse(await readJson(request));
    await endProjectAssignment(context, employeeId, assignmentId, input);
    return apiOk({ data: { ended: true } });
  });
}
