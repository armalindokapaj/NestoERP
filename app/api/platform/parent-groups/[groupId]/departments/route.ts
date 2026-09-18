import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { createGroupDepartment } from "@/lib/modules/organization/departments/department.config.service";
import { listGroupDepartments } from "@/lib/modules/organization/departments/department.query";
import { createDepartmentSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ groupId: string }> };

/** GET /api/platform/parent-groups/:groupId/departments — the group's departments, as Organization reads them (E-13 §50, §51). */
export async function GET(_request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => apiOk({ data: await listGroupDepartments(platformActor(context, groupId), { status: "ALL" }) }));
}

/** POST /api/platform/parent-groups/:groupId/departments — a new group department, while the group is being implemented (E-13 §50, §94). */
export async function POST(request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => {
    const input = createDepartmentSchema.parse(await readJson(request));
    return apiOk({ data: await createGroupDepartment(platformActor(context, groupId), input) }, { status: 201 });
  });
}
