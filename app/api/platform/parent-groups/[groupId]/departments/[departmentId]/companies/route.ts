import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { activateInCompanies } from "@/lib/modules/organization/departments/department.config.service";
import { activateCompaniesSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ groupId: string; departmentId: string }> };

/** POST /api/platform/parent-groups/:groupId/departments/:departmentId/companies — activate in companies of the group (E-13 §42, §50). */
export async function POST(request: Request, { params }: Params) {
  const { groupId, departmentId } = await params;
  return withPlatformContext(async (context) => {
    const input = activateCompaniesSchema.parse(await readJson(request));
    return apiOk({ data: await activateInCompanies(platformActor(context, groupId), decodeURIComponent(departmentId), input.companyIds) });
  });
}
