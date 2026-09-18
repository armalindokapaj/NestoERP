import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { addDepartmentMember } from "@/lib/modules/organization/departments/department.assignment.service";
import { listBranchMembers } from "@/lib/modules/organization/departments/department.query";
import { addMemberSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ companyDepartmentId: string }> };

/** GET /api/organization/company-departments/:companyDepartmentId/members — its manager and members (E-13 §72). */
export async function GET(_request: Request, { params }: Params) {
  const { companyDepartmentId } = await params;
  return withContext(async (context) => apiOk({ data: await listBranchMembers(memberActor(context), companyDepartmentId) }));
}

/** POST /api/organization/company-departments/:companyDepartmentId/members — add an existing person; nothing else is created (E-13 §45, §72, §79). */
export async function POST(request: Request, { params }: Params) {
  const { companyDepartmentId } = await params;
  return withContext(async (context) => {
    const input = addMemberSchema.parse(await readJson(request));
    return apiOk({ data: await addDepartmentMember(memberActor(context), companyDepartmentId, input) }, { status: 201 });
  });
}
