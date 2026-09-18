import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { getCompanyDepartments } from "@/lib/modules/organization/departments/department.query";

type Params = { params: Promise<{ companyId: string }> };

/** GET /api/organization/companies/:companyId/departments — every department of the group as that company runs it (E-13 §39, §74). */
export async function GET(_request: Request, { params }: Params) {
  const { companyId } = await params;
  return withContext(async (context) => apiOk({ data: await getCompanyDepartments(memberActor(context), companyId) }));
}
