import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { setGroupDepartmentStatus } from "@/lib/modules/organization/departments/department.config.service";

type Params = { params: Promise<{ departmentId: string }> };

/** POST /api/organization/departments/:departmentId/reactivate — the same department, with everything it had (E-13 §68, §140). */
export async function POST(_request: Request, { params }: Params) {
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => {
    await setGroupDepartmentStatus(memberActor(context), departmentId, "ACTIVE");
    return apiOk({ data: { ok: true } });
  });
}
