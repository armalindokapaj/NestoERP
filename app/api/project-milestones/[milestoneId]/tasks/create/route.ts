import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createTaskFromMilestone } from "@/lib/modules/project-planning/planning.links";
import { createTaskFromMilestoneSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — create a task through the task service and link it (PRD #44 §55, §193). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = createTaskFromMilestoneSchema.parse(await readJson(request));
    return apiOk({ data: await createTaskFromMilestone(context, milestoneId, input) }, { status: 201 });
  });
}
