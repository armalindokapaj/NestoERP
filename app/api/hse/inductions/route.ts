import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { AccessError } from "@/lib/access/guards";
import { inductionSchema } from "@/lib/modules/hse/hse.schema";
import { inductionsForProject, inductionsForWorker, recordInduction } from "@/lib/modules/hse/hse.workforce";

/**
 * GET  /api/hse/inductions?projectId= | ?employeeId= — site inductions, within
 *      the reader's HSE project scope (E-04 §71, §142).
 * POST /api/hse/inductions — record one given today or earlier (`hse.induction.record`).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const projectId = params.get("projectId");
    const employeeId = params.get("employeeId");
    if (projectId) return apiOk({ data: await inductionsForProject(context, projectId) });
    if (employeeId) return apiOk({ data: await inductionsForWorker(context, employeeId) });
    throw new AccessError("VALIDATION_ERROR", "Name a project or an employee.");
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => apiOk({ data: await recordInduction(context, inductionSchema.parse(await readJson(request))) }, { status: 201 }));
}
