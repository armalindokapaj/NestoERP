import { apiOk, withContext } from "@/lib/api/respond";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * A dedicated status action rather than a PATCH, so the permission that owns
 * the transition is the one that is checked (PRD #11 §61, §159).
 */
export async function POST(_request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await tasks.completeTask(context, taskId) }),
  );
}
