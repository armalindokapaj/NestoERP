import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { updateGroupDepartment } from "@/lib/modules/organization/departments/department.config.service";
import { getDepartmentDetail } from "@/lib/modules/organization/departments/department.query";
import { updateDepartmentSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ groupId: string; departmentId: string }> };

/** GET /api/platform/parent-groups/:groupId/departments/:departmentId — the department and each company's branch (E-13 §50). */
export async function GET(_request: Request, { params }: Params) {
  const { groupId, departmentId } = await params;
  return withPlatformContext(async (context) => apiOk({ data: await getDepartmentDetail(platformActor(context, groupId), decodeURIComponent(departmentId)) }));
}

/** PATCH /api/platform/parent-groups/:groupId/departments/:departmentId — name, code, description (E-13 §50). */
export async function PATCH(request: Request, { params }: Params) {
  const { groupId, departmentId } = await params;
  return withPlatformContext(async (context) => {
    const input = updateDepartmentSchema.parse(await readJson(request));
    await updateGroupDepartment(platformActor(context, groupId), decodeURIComponent(departmentId), input);
    return apiOk({ data: { ok: true } });
  });
}
