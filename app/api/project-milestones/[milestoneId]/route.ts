import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { archiveMilestone, updateMilestone } from "@/lib/modules/project-planning/planning.milestones";
import { updateMilestoneSchema } from "@/lib/modules/project-planning/planning.schema";
import { getMilestone } from "@/lib/modules/project-planning/planning.service";

type Params = { params: Promise<{ milestoneId: string }> };

/** GET — one milestone with its dates, dependencies, tasks, blockers, links, files and history (PRD #44 §109, §188). */
export async function GET(_request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => apiOk({ data: await getMilestone(context, milestoneId) }));
}

/** PATCH — edit it; the baseline and completion have their own commands (PRD #44 §188, §205). */
export async function PATCH(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = updateMilestoneSchema.parse(await readJson(request));
    return apiOk({ data: await updateMilestone(context, milestoneId, input) });
  });
}

/** DELETE — archive it, once nothing live depends on it (PRD #44 §188, §270). */
export async function DELETE(_request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    await archiveMilestone(context, milestoneId);
    return apiOk({ data: { archived: true } });
  });
}
