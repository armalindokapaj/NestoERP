import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { setBaselineLock } from "@/lib/modules/project-planning/planning.milestones";
import { projectPlanningSettingsSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ projectId: string }> };

/** PUT — lock or unlock the project's baseline (PRD #44 §76, §310). */
export async function PUT(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = projectPlanningSettingsSchema.parse(await readJson(request));
    return apiOk({ data: await setBaselineLock(context, projectId, input.baselineLocked) });
  });
}
