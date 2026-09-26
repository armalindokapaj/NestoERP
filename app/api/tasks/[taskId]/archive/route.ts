import { withContext } from "@/lib/api/respond";
import { commandResponse, readCommandBody } from "@/lib/modules/tasks/task.http";
import { taskCommandSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * Archive is its own endpoint: `ARCHIVED` is not a status a PATCH may set, and
 * the archived task remembers where it was so restore can put it back
 * (PRD #11 §71, §117). Body `{ expectedVersion }`; answers `{ data, meta }`
 * (AUD-02 §6).
 */
export async function POST(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const input = taskCommandSchema.parse(await readCommandBody(request));
    return commandResponse(await tasks.archiveTask(context, taskId, input));
  });
}
