import { withContext } from "@/lib/api/respond";
import { commandResponse, readCommandBody } from "@/lib/modules/tasks/task.http";
import { blockTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * A dedicated status action rather than a PATCH, so the permission that owns
 * the transition is the one that is checked (PRD #11 §61, §159). Body
 * `{ expectedVersion, reason }`: the reason is 3–1,000 characters once
 * trimmed, checked by the command for every transport (AUD-02 §5).
 */
export async function POST(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const input = blockTaskSchema.parse(await readCommandBody(request));
    return commandResponse(await tasks.blockTask(context, taskId, input));
  });
}
