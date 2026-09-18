import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { applyEmploymentChange } from "@/lib/modules/hr/employment/employment.change.service";
import { employmentChangeSchema } from "@/lib/modules/hr/employment/employment.schema";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { endWorkforce } from "@/lib/modules/workforce/workforce.end";

type Params = { params: Promise<{ employeeId: string }> };

/**
 * POST /api/hr/employees/:employeeId/employment-changes — one typed employment
 * change (E-03 §36, §74, §75): POSITION, DEPARTMENT, LEGAL_ENTITY, MANAGER,
 * LOCATION, EMPLOYMENT_TYPE, STATUS, TERMINATE or REHIRE, from its effective
 * date. Today applies it, a later date schedules it, an earlier one backdates
 * it with the correction permission. Never a PATCH of organization fields (§37).
 */
export async function POST(request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const input = employmentChangeSchema.parse(await readJson(request));
    const result = await applyEmploymentChange(context, employeeId, input, { placement: placeMembership, workforce: endWorkforce });
    return apiOk({ data: result }, { status: result.outcome === "SCHEDULED" ? 202 : 200 });
  });
}
