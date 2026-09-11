import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createEmployeeProfileSchema } from "@/lib/modules/hr/hr.schema";
import { parseEmployeeQuery } from "@/lib/modules/hr/hr.query";
import * as employees from "@/lib/modules/hr/employees/employee.service";

/**
 * GET  /api/hr/employees — scoped, filtered, paginated (PRD #16 §176).
 * POST /api/hr/employees — create an employment record for a team member.
 *
 * `companyId`, `employmentStatus` and every audit field are absent from the
 * schema, so they cannot be set from a request body (PRD #16 §183).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await employees.listEmployees(context, parseEmployeeQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createEmployeeProfileSchema.parse(await readJson(request));
    return apiOk({ data: await employees.createEmployeeProfile(context, input) }, { status: 201 });
  });
}
