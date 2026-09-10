import type { TaskStatus } from "@prisma/client";

import { apiOk, withContext } from "@/lib/api/respond";
import { reopenTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * Reopening a completed task clears its completion timestamp and returns it to
 * To Do unless another open status is requested (PRD #11 §70).
 */
export async function POST(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const body = await request
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const input = reopenTaskSchema.parse(
      body && typeof body === "object" && !Array.isArray(body) ? body : {},
    );
    const target = (input.status ?? "TODO") as TaskStatus;
    return apiOk({ data: await tasks.reopenTask(context, taskId, target) });
  });
}
