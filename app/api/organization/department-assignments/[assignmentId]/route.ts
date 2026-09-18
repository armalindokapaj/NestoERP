import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { endDepartmentAssignment, moveDepartmentMember } from "@/lib/modules/organization/departments/department.assignment.service";
import { updateAssignmentSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ assignmentId: string }> };

/** PATCH /api/organization/department-assignments/:assignmentId — move a member's place to another company's branch; the old one ends as history (E-13 §72, §85). */
export async function PATCH(request: Request, { params }: Params) {
  const { assignmentId } = await params;
  return withContext(async (context) => {
    const input = updateAssignmentSchema.parse(await readJson(request));
    return apiOk({ data: await moveDepartmentMember(memberActor(context), assignmentId, input) });
  });
}

/** DELETE /api/organization/department-assignments/:assignmentId — ends the place; it is kept as history, never deleted (E-13 §47, §72). */
export async function DELETE(_request: Request, { params }: Params) {
  const { assignmentId } = await params;
  return withContext(async (context) => {
    await endDepartmentAssignment(memberActor(context), assignmentId);
    return apiOk({ data: { ok: true } });
  });
}
