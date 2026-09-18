import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { deactivateInCompany } from "@/lib/modules/organization/departments/department.config.service";

type Params = { params: Promise<{ groupId: string; departmentId: string; companyId: string }> };

/** POST …/departments/:departmentId/companies/:companyId/deactivate — undo an activation while implementing; the branch is kept (E-13 §18, §50). */
export async function POST(_request: Request, { params }: Params) {
  const { groupId, departmentId, companyId } = await params;
  return withPlatformContext(async (context) => apiOk({ data: await deactivateInCompany(platformActor(context, groupId), decodeURIComponent(departmentId), companyId) }));
}
