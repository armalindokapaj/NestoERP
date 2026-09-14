import { apiOk, withContext } from "@/lib/api/respond";
import { getPlanningTimeline } from "@/lib/modules/project-planning/planning.service";

type Params = { params: Promise<{ projectId: string }> };

/** GET — phase ranges, milestone points and dependency edges only (PRD #44 §278). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await getPlanningTimeline(context, projectId) }));
}
