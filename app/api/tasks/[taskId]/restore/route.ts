import { withContext } from "@/lib/api/respond";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/** Restore returns the task to the status it held before archiving (PRD #11 §73). */
export async function POST(_request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    await tasks.restoreTask(context, taskId);
    return new Response(null, { status: 204 });
  });
}
