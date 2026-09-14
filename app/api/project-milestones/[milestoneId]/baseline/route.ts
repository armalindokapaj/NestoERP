import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { changeBaseline } from "@/lib/modules/project-planning/planning.milestones";
import { baselineSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — move the baseline: its own grant, a reason and an audit entry (PRD #44 §22, §23, §196). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = baselineSchema.parse(await readJson(request));
    return apiOk({ data: await changeBaseline(context, milestoneId, input) });
  });
}
