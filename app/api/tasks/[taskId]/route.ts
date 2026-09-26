import { apiOk, withContext } from "@/lib/api/respond";
import { commandResponse, readCommandBody } from "@/lib/modules/tasks/task.http";
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

/**
 * The edit, against the version the person reviewed (`expectedVersion`):
 * 428 without one, 409 TASK_VERSION_CONFLICT when the task has moved on
 * (AUD-02 §6). Answers `{ data, meta }`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const input = updateTaskSchema.parse(await readCommandBody(request));
    return commandResponse(await tasks.updateTask(context, taskId, input));
  });
}
