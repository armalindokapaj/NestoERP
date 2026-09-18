import { apiOk, withContext } from "@/lib/api/respond";
import { getEmploymentHistory } from "@/lib/modules/hr/employment/employment.query";

type Params = { params: Promise<{ employeeId: string }> };

/**
 * GET /api/hr/employees/:employeeId/employment-history — the employment's
 * organization and status history (E-03 §72, §73): HR's view with
 * `hr.employment_history.view` in scope, or the employee's own. The current
 * record's DTO never carries it (§69, §174).
 */
export async function GET(_request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => apiOk({ data: await getEmploymentHistory(context, employeeId) }));
}
