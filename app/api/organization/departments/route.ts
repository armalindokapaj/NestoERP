import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { createGroupDepartment } from "@/lib/modules/organization/departments/department.config.service";
import { listGroupDepartments } from "@/lib/modules/organization/departments/department.query";
import { createDepartmentSchema, departmentListQuerySchema } from "@/lib/modules/organization/departments/department.schema";

/** GET /api/organization/departments — the group's departments (E-13 §32, §68); `?status=ALL` adds inactive ones for those who configure them. */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const query = departmentListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listGroupDepartments(memberActor(context), query) });
  });
}

/** POST /api/organization/departments — a new group department (E-13 §40, §68, §77). */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createDepartmentSchema.parse(await readJson(request));
    return apiOk({ data: await createGroupDepartment(memberActor(context), input) }, { status: 201 });
  });
}
