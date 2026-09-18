import { apiOk, withContext } from "@/lib/api/respond";
import { memberActor } from "@/lib/modules/organization/departments/department.actor";
import { getDepartmentTeam } from "@/lib/modules/organization/departments/department.query";
import { teamQuerySchema } from "@/lib/modules/organization/departments/department.schema";

type Params = { params: Promise<{ departmentId: string }> };

/** GET /api/organization/departments/:departmentId/team?company=&position=&status=&search= — its people across the companies in reach (E-13 §36, §73). */
export async function GET(request: Request, { params }: Params) {
  const departmentId = decodeURIComponent((await params).departmentId);
  return withContext(async (context) => {
    const query = teamQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await getDepartmentTeam(memberActor(context), departmentId, query) });
  });
}
