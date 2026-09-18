import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { setGroupDepartmentStatus } from "@/lib/modules/organization/departments/department.config.service";

type Params = { params: Promise<{ departmentId: string }> };

/** POST /api/organization/departments/:departmentId/deactivate — no new company, member or head; its branches, people and history stay (E-13 §68, §90). */
export async function POST(_request: Request, { params }: Params) {
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => {
    await setGroupDepartmentStatus(memberActor(context), departmentId, "INACTIVE");
    return apiOk({ data: { ok: true } });
  });
}
