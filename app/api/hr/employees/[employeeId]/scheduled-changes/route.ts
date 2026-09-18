import { AccessError } from "@/lib/access/guards";
import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { applyEmploymentChange } from "@/lib/modules/hr/employment/employment.change.service";
import { todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { getEmploymentHistory } from "@/lib/modules/hr/employment/employment.query";
import { employmentChangeSchema } from "@/lib/modules/hr/employment/employment.schema";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";

type Params = { params: Promise<{ employeeId: string }> };

/** GET — the employment's scheduled changes, HR's view only (E-03 §77, §162). */
export async function GET(_request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const history = await getEmploymentHistory(context, employeeId);
    if (history.view !== "HR") throw new AccessError("FORBIDDEN");
    return apiOk({ data: history.scheduled });
  });
}

/** POST — schedules a change for a future date (E-03 §31, §77); a date not in the future is refused here. */
export async function POST(request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const input = employmentChangeSchema.parse(await readJson(request));
    const effective = input.action === "TERMINATE" ? input.lastWorkingDay : input.effectiveDate;
    if (effective < todayDay() || (input.action !== "TERMINATE" && effective === todayDay())) {
      throw new AccessError("VALIDATION_ERROR", "A scheduled change takes effect after today.", { field: "effectiveDate" });
    }
    const result = await applyEmploymentChange(context, employeeId, input, { placement: placeMembership });
    if (result.outcome !== "SCHEDULED") throw new AccessError("VALIDATION_ERROR", "This change applies now; it was not scheduled.");
    return apiOk({ data: result }, { status: 202 });
  });
}
