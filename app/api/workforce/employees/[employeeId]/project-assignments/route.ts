import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { assignmentsOf, assignToProject } from "@/lib/modules/workforce/assignment.service";
import { requireReadableWorker } from "@/lib/modules/workforce/workforce.directory";
import { projectAssignmentSchema } from "@/lib/modules/workforce/workforce.schema";

type Params = { params: Promise<{ employeeId: string }> };

/**
 * GET  /api/workforce/employees/:employeeId/project-assignments — where they work, and where they did (E-04 §39, §41).
 * POST /api/workforce/employees/:employeeId/project-assignments — assign them, or move them with `transferFromId` (§160).
 *
 * A workforce assignment, not project access: nobody becomes a project member here (§35).
 */
export async function GET(_request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const worker = await requireReadableWorker(context, employeeId);
    return apiOk({ data: await assignmentsOf(context, worker.id) });
  });
}

export async function POST(request: Request, { params }: Params) {
  const { employeeId } = await params;
  return withContext(async (context) => {
    const input = projectAssignmentSchema.parse(await readJson(request));
    return apiOk({ data: await assignToProject(context, employeeId, input) }, { status: 201 });
  });
}
