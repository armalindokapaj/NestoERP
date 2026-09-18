import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { platformActor } from "@/lib/modules/organization/departments/department.actor";
import { listDepartmentCandidates } from "@/lib/modules/organization/departments/department.query";
import { candidatesQuerySchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ groupId: string; departmentId: string }> };

/** GET …/departments/:departmentId/candidates — the group's people who could hold a place in it (E-13 §43, §44, §50). */
export async function GET(request: Request, { params }: Params) {
  const { groupId, departmentId } = await params;
  return withPlatformContext(async (context) => {
    const query = candidatesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listDepartmentCandidates(platformActor(context, groupId), decodeURIComponent(departmentId), query) });
  });
}
