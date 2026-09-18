import { apiOk, withContext } from "@/lib/api/respond";
import * as departments from "@/lib/modules/team/departments/department.service";

type Params = { params: Promise<{ departmentId: string }> };

/** GET /api/departments/:departmentId — one of the company's departments (PRD #14; read only since E-13). */
export async function GET(_request: Request, { params }: Params) {
  const { departmentId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await departments.getDepartment(context, departmentId) }),
  );
}
