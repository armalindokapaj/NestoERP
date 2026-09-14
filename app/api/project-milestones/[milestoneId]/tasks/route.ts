import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { linkTask } from "@/lib/modules/project-planning/planning.links";
import { linkTaskSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — link a task of the same project (PRD #44 §49-§51, §193). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = linkTaskSchema.parse(await readJson(request));
    await linkTask(context, milestoneId, input);
    return apiOk({ data: { linked: true } }, { status: 201 });
  });
}
