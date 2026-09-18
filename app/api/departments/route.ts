import { apiOk, withContext } from "@/lib/api/respond";
import * as departments from "@/lib/modules/team/departments/department.service";

/**
 * GET /api/departments — the company's departments (PRD #14). Read only since
 * E-13: a department is activated in a company from Organization
 * (`/api/organization/departments/:id/companies`), never created here.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const includeInactive = new URL(request.url).searchParams.get("inactive") === "true";
    return apiOk({ data: await departments.listDepartments(context, { includeInactive }) });
  });
}
