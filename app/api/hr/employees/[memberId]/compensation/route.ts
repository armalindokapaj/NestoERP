import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createCompensationSchema } from "@/lib/modules/hr/hr.schema";
import * as compensation from "@/lib/modules/hr/compensation/compensation.service";

type Params = { params: Promise<{ memberId: string }> };

/**
 * Compensation (PRD #16 §177).
 *
 * Behind `hr.compensation.view` and `hr.compensation.update`, which employee
 * access never implies — including for your own pay (PRD #16 §17, §67).
 */
export async function GET(_request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await compensation.listCompensation(context, memberId) }),
  );
}

export async function POST(request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => {
    const input = createCompensationSchema.parse(await readJson(request));
    await compensation.recordCompensation(context, memberId, input);
    return apiOk({ data: await compensation.listCompensation(context, memberId) }, { status: 201 });
  });
}
