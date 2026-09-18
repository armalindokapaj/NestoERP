import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { deactivateInCompany } from "@/lib/modules/organization/departments/department.config.service";

type Params = { params: Promise<{ departmentId: string; companyId: string }> };

/** POST /api/organization/departments/:departmentId/companies/:companyId/deactivate — its branch there is closed and kept, with its people and history (E-13 §18, §69). */
export async function POST(_request: Request, { params }: Params) {
  const { departmentId: raw, companyId } = await params;
  const departmentId = decodeURIComponent(raw);
  return withContext(async (context) => apiOk({ data: await deactivateInCompany(memberActor(context), departmentId, companyId) }));
}
