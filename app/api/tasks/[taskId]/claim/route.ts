import { withContext } from "@/lib/api/respond";
import { commandResponse, readCommandBody } from "@/lib/modules/tasks/task.http";
import { taskCommandSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * Claim an unassigned task (MOB-06 §22). Like the other commands, the permission that owns
 * the transition is the one that is checked (PRD #11 §61, §159). Body
 * `{ expectedVersion }`; answers `{ data, meta }` (AUD-02 §6).
 */
export async function POST(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const input = taskCommandSchema.parse(await readCommandBody(request));
    return commandResponse(await tasks.claimTask(context, taskId, input));
  });
}
