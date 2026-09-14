import { apiOk, withContext } from "@/lib/api/respond";
import { getPlanningOverview } from "@/lib/modules/project-planning/planning.service";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's plan: phases, milestones, dependencies, metrics and what this reader may do (PRD #44 §186, §276). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await getPlanningOverview(context, projectId) }));
}
