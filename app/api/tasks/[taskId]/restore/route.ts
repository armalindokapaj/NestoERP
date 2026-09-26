import { withContext } from "@/lib/api/respond";
import { commandResponse, readCommandBody } from "@/lib/modules/tasks/task.http";
import { taskCommandSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * Restore returns the task to the status it held before archiving (PRD #11 §73).
 * Body `{ expectedVersion }`; answers `{ data, meta }` (AUD-02 §6).
 */
export async function POST(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const input = taskCommandSchema.parse(await readCommandBody(request));
    return commandResponse(await tasks.restoreTask(context, taskId, input));
  });
}
