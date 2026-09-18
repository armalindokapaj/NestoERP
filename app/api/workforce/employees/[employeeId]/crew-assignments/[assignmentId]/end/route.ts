import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { endCrewMembership } from "@/lib/modules/workforce/crew.service";
import { endAssignmentSchema } from "@/lib/modules/workforce/workforce.schema";

type Params = { params: Promise<{ employeeId: string; assignmentId: string }> };

/** POST /api/workforce/employees/:employeeId/crew-assignments/:assignmentId/end — out of the crew after a last day (E-04 §159). */
export async function POST(request: Request, { params }: Params) {
  const { employeeId, assignmentId } = await params;
  return withContext(async (context) => {
    const input = endAssignmentSchema.parse(await readJson(request));
    await endCrewMembership(context, employeeId, assignmentId, input);
    return apiOk({ data: { ended: true } });
  });
}
