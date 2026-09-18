import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { getDepartmentActivity } from "@/lib/modules/organization/departments/department.query";

type Params = { params: Promise<{ departmentId: string }> };

/** GET /api/organization/departments/:departmentId/activity — what happened to it, newest first (E-13 §38). */
export async function GET(_request: Request, { params }: Params) {
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => apiOk({ data: await getDepartmentActivity(memberActor(context), departmentId) }));
}
