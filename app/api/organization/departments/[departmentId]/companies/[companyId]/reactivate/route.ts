import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { activateInCompanies } from "@/lib/modules/organization/departments/department.config.service";

type Params = { params: Promise<{ departmentId: string; companyId: string }> };

/** POST /api/organization/departments/:departmentId/companies/:companyId/reactivate — the branch it had there, reopened (E-13 §19, §69). */
export async function POST(_request: Request, { params }: Params) {
  const { departmentId: raw, companyId } = await params;
  const departmentId = decodeURIComponent(raw);
  return withContext(async (context) => apiOk({ data: (await activateInCompanies(memberActor(context), departmentId, [companyId], { requireExisting: true }))[0] }));
}
