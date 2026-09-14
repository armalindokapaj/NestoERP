import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reopenMilestone } from "@/lib/modules/project-planning/planning.milestones";
import { reopenMilestoneSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — reopen a completed milestone, with a reason (PRD #44 §31, §190, §203). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = reopenMilestoneSchema.parse(await readJson(request));
    return apiOk({ data: await reopenMilestone(context, milestoneId, input) });
  });
}
