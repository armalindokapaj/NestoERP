import type { TaskStatus } from "@prisma/client";

import { withContext } from "@/lib/api/respond";
import { commandResponse, readCommandBody } from "@/lib/modules/tasks/task.http";
import { reopenTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * Reopening a completed task clears its completion timestamp and returns it to
 * To Do unless another open status is requested (PRD #11 §70). Body
 * `{ expectedVersion, status? }`; answers `{ data, meta }` (AUD-02 §6).
 */
export async function POST(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const input = reopenTaskSchema.parse(await readCommandBody(request));
    return commandResponse(
      await tasks.reopenTask(context, taskId, { expectedVersion: input.expectedVersion, status: input.status as TaskStatus | undefined }),
    );
  });
}
