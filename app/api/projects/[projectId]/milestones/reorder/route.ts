import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderMilestones } from "@/lib/modules/project-planning/planning.milestones";
import { reorderMilestonesSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ projectId: string }> };

/** POST — the order of the milestones in one phase (PRD #44 §27). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = reorderMilestonesSchema.parse(await readJson(request));
    await reorderMilestones(context, projectId, input);
    return apiOk({ data: { ok: true } });
  });
}
