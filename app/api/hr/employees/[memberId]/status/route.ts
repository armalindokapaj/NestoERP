import { readJson, withContext } from "@/lib/api/respond";
import { employmentStatusSchema } from "@/lib/modules/hr/hr.schema";
import * as employees from "@/lib/modules/hr/employees/employee.service";

type Params = { params: Promise<{ memberId: string }> };

/**
 * Changes employment status (PRD #16 §54, §55).
 *
 * Company access is untouched: ending employment and removing a login are two
 * decisions, taken by two modules (PRD #16 §230).
 */
export async function POST(request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => {
    const input = employmentStatusSchema.parse(await readJson(request));
    await employees.changeEmploymentStatus(context, memberId, input);
    return new Response(null, { status: 204 });
  });
}
