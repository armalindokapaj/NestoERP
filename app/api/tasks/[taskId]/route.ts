import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * A task outside the caller's scope answers 404 rather than 403, so the
 * response cannot be used to discover that it exists (PRD #11 §120).
 */
export async function GET(_request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => apiOk({ data: await tasks.getTask(context, taskId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const body = await readJson(request);
    const input = updateTaskSchema.parse(body);
    return apiOk({ data: await tasks.updateTask(context, taskId, input) });
  });
}
