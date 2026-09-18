import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { updateGroupDepartment } from "@/lib/modules/organization/departments/department.config.service";
import { getDepartmentDetail } from "@/lib/modules/organization/departments/department.query";
import { updateDepartmentSchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ departmentId: string }> };

/** GET /api/organization/departments/:departmentId — the department, its head and each company's branch in reach (E-13 §33-§35, §68). */
export async function GET(_request: Request, { params }: Params) {
  // Group department ids carry the group's id and a colon, which may arrive encoded.
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => apiOk({ data: await getDepartmentDetail(memberActor(context), departmentId) }));
}

/** PATCH /api/organization/departments/:departmentId — name, code, description (E-13 §34, §68). */
export async function PATCH(request: Request, { params }: Params) {
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => {
    const input = updateDepartmentSchema.parse(await readJson(request));
    await updateGroupDepartment(memberActor(context), departmentId, input);
    return apiOk({ data: await getDepartmentDetail(memberActor(context), departmentId) });
  });
}
