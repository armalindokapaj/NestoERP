import { withContext } from "@/lib/api/respond";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * Archive is its own endpoint: `ARCHIVED` is not a status a PATCH may set, and
 * the archived task remembers where it was so restore can put it back
 * (PRD #11 §71, §117).
 */
export async function POST(_request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    await tasks.archiveTask(context, taskId);
    return new Response(null, { status: 204 });
  });
}
