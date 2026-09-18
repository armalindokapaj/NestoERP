import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { assignToCrew, crewMembershipsOf } from "@/lib/modules/workforce/crew.service";
import { requireReadableWorker } from "@/lib/modules/workforce/workforce.directory";
import { crewAssignmentSchema } from "@/lib/modules/workforce/workforce.schema";

type Params = { params: Promise<{ employeeId: string }> };

/**
 * GET  /api/workforce/employees/:employeeId/crew-assignments — their crews, current and past (E-04 §30).
 * POST /api/workforce/employees/:employeeId/crew-assignments — put them in a crew, or move them (§159).
 *
 * The employee is an employment, with or without a login.
 */
export async function GET(_request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const worker = await requireReadableWorker(context, employeeId);
    return apiOk({ data: await crewMembershipsOf(context, worker.id) });
  });
}

export async function POST(request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const input = crewAssignmentSchema.parse(await readJson(request));
    return apiOk({ data: await assignToCrew(context, employeeId, input) }, { status: 201 });
  });
}
