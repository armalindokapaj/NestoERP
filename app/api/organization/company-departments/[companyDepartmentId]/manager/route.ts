import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { appointCompanyManager } from "@/lib/modules/organization/departments/department.assignment.service";
import { appointPersonSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ companyDepartmentId: string }> };

/** POST /api/organization/company-departments/:companyDepartmentId/manager — appoint the branch's manager; `replace` ends the one in office (E-13 §20, §22, §71). */
export async function POST(request: Request, { params }: Params) {
  const { companyDepartmentId } = await params;
  return withContext(async (context) => {
    const input = appointPersonSchema.parse(await readJson(request));
    return apiOk({ data: await appointCompanyManager(memberActor(context), companyDepartmentId, input) }, { status: 201 });
  });
}
