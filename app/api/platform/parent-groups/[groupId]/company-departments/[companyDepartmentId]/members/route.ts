import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { addDepartmentMember } from "@/lib/modules/organization/departments/department.assignment.service";
import { addMemberSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ groupId: string; companyDepartmentId: string }> };

/** POST …/company-departments/:companyDepartmentId/members — an existing person of the roster into a branch (E-13 §50, §124). */
export async function POST(request: Request, { params }: Params) {
  const { groupId, companyDepartmentId } = await params;
  return withPlatformContext(async (context) => {
    const input = addMemberSchema.parse(await readJson(request));
    return apiOk({ data: await addDepartmentMember(platformActor(context, groupId), companyDepartmentId, input) }, { status: 201 });
  });
}
