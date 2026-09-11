import { z } from "zod";

import { readJson, withContext } from "@/lib/api/respond";
import { PROGRESS_STATUSES } from "@/lib/modules/hr/hr.schema";
import * as employees from "@/lib/modules/hr/employees/employee.service";

type Params = { params: Promise<{ memberId: string }> };

const schema = z.object({
  kind: z.enum(["onboarding", "offboarding"]),
  status: z.enum(PROGRESS_STATUSES),
});

/** Onboarding and offboarding progress (PRD #16 §121, §123). */
export async function POST(request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => {
    const input = schema.parse(await readJson(request));
    await employees.setProgress(context, memberId, input.kind, input.status);
    return new Response(null, { status: 204 });
  });
}
