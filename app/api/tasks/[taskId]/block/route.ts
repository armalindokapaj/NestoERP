import { z } from "zod";

import { apiOk, readJson, withContext } from "@/lib/api/respond";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/**
 * A dedicated status action rather than a PATCH, so the permission that owns
 * the transition is the one that is checked (PRD #11 §61, §159).
 */
const blockSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export async function POST(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const { reason } = blockSchema.parse(await readJson(request));
    return apiOk({ data: await tasks.blockTask(context, taskId, reason) });
  });
}
