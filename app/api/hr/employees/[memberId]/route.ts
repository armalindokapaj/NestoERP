import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateEmployeeProfileSchema } from "@/lib/modules/hr/hr.schema";
import * as employees from "@/lib/modules/hr/employees/employee.service";

type Params = { params: Promise<{ memberId: string }> };

/**
 * One employment record, addressed by membership id (PRD #16 §176).
 *
 * Out of scope answers 404, not 403, so the response cannot confirm that
 * somebody works here to a reader who may not see them (PRD #16 §202).
 */
export async function GET(_request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await employees.getEmployee(context, memberId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => {
    // Status is not a field here: it has its own endpoint, so "update" can
    // never end somebody's employment by accident (PRD #16 §54).
    const input = updateEmployeeProfileSchema.parse(await readJson(request));
    return apiOk({ data: await employees.updateEmployeeProfile(context, memberId, input) });
  });
}
