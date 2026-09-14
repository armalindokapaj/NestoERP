import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { copyPlanningSchema } from "@/lib/modules/project-planning/planning.schema";
import { copyCandidates, copyPlanning } from "@/lib/modules/project-planning/planning.templates";

type Params = { params: Promise<{ projectId: string }> };

/** GET — projects in this company whose plan this reader could copy (PRD #44 §138). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await copyCandidates(context, projectId) }));
}

/** POST — copy another project's structure into this empty plan (PRD #44 §139). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = copyPlanningSchema.parse(await readJson(request));
    return apiOk({ data: await copyPlanning(context, projectId, input.sourceProjectId) }, { status: 201 });
  });
}
