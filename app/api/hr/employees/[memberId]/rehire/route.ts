import { z } from "zod";

import { readJson, withContext } from "@/lib/api/respond";
import * as employees from "@/lib/modules/hr/employees/employee.service";

type Params = { params: Promise<{ memberId: string }> };

const schema = z.object({ startDate: z.coerce.date() });

/** Reopens ended employment with a new start date (PRD #16 §56). */
export async function POST(request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => {
    const input = schema.parse(await readJson(request));
    await employees.rehireEmployee(context, memberId, input.startDate);
    return new Response(null, { status: 204 });
  });
}
