import { apiOk, withContext } from "@/lib/api/respond";
import { unlinkTask } from "@/lib/modules/project-planning/planning.links";

type Params = { params: Promise<{ milestoneId: string; taskId: string }> };

/** DELETE — unlink a task; the task itself is untouched (PRD #44 §193). */
export async function DELETE(_request: Request, { params }: Params) {
  const { milestoneId, taskId } = await params;
  return withContext(async (context) => {
    await unlinkTask(context, milestoneId, taskId);
    return apiOk({ data: { removed: true } });
  });
}
