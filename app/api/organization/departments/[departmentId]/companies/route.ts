import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { activateInCompanies } from "@/lib/modules/organization/departments/department.config.service";
import { activateCompaniesSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ departmentId: string }> };

/** POST /api/organization/departments/:departmentId/companies — activate in several companies at once; each branch is created or reopened (E-13 §41, §42, §137). */
export async function POST(request: Request, { params }: Params) {
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => {
    const input = activateCompaniesSchema.parse(await readJson(request));
    return apiOk({ data: await activateInCompanies(memberActor(context), departmentId, input.companyIds) });
  });
}
