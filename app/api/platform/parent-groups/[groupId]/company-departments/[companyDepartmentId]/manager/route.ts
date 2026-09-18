import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { appointCompanyManager } from "@/lib/modules/organization/departments/department.assignment.service";
import { appointPersonSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ groupId: string; companyDepartmentId: string }> };

/** POST …/company-departments/:companyDepartmentId/manager — a branch's initial manager (E-13 §50, §94). */
export async function POST(request: Request, { params }: Params) {
  const { groupId, companyDepartmentId } = await params;
  return withPlatformContext(async (context) => {
    const input = appointPersonSchema.parse(await readJson(request));
    return apiOk({ data: await appointCompanyManager(platformActor(context, groupId), companyDepartmentId, input) }, { status: 201 });
  });
}
