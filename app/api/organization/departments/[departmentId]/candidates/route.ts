import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { listDepartmentCandidates } from "@/lib/modules/organization/departments/department.query";
import { candidatesQuerySchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ departmentId: string }> };

/** GET /api/organization/departments/:departmentId/candidates?position=&company=&search= — people of the group who could hold it, and why not (E-13 §43, §44, §84). */
export async function GET(request: Request, { params }: Params) {
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => {
    const query = candidatesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listDepartmentCandidates(memberActor(context), departmentId, query) });
  });
}
