import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { activateInCompanies } from "@/lib/modules/organization/departments/department.config.service";

type Params = { params: Promise<{ departmentId: string; companyId: string }> };

/** POST /api/organization/departments/:departmentId/companies/:companyId/activate — its branch there is created, or reopened as the same branch; again, nothing changes (E-13 §17, §69, §137). */
export async function POST(_request: Request, { params }: Params) {
  const { departmentId: raw, companyId } = await params;
  const departmentId = decodeURIComponent(raw);
  return withContext(async (context) => apiOk({ data: (await activateInCompanies(memberActor(context), departmentId, [companyId]))[0] }));
}
