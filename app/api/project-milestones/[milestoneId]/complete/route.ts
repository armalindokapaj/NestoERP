import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { completeMilestone } from "@/lib/modules/project-planning/planning.milestones";
import { completeMilestoneSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — mark complete with its actual date, today unless given (PRD #44 §30, §112, §189). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = completeMilestoneSchema.parse(await readJson(request));
    return apiOk({ data: await completeMilestone(context, milestoneId, input) });
  });
}
