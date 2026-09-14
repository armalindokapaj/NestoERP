import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { quickUpdateMilestone } from "@/lib/modules/project-planning/planning.milestones";
import { quickUpdateSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — status, forecast or progress on their own, from a phone (PRD #44 §119, §247). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = quickUpdateSchema.parse(await readJson(request));
    return apiOk({ data: await quickUpdateMilestone(context, milestoneId, input) });
  });
}
