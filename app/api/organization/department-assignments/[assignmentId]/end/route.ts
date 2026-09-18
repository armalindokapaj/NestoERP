import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { endDepartmentAssignment } from "@/lib/modules/organization/departments/department.assignment.service";

type Params = { params: Promise<{ assignmentId: string }> };

/** POST /api/organization/department-assignments/:assignmentId/end — a head's, manager's or member's place ends and stays as history (E-06 §90; E-13 §47, §67). */
export async function POST(_request: Request, { params }: Params) {
  const { assignmentId } = await params;
  return withContext(async (context) => {
    await endDepartmentAssignment(memberActor(context), assignmentId);
    return apiOk({ data: { ok: true } });
  });
}
