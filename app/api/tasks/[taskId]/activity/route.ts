import { apiOk, withContext } from "@/lib/api/respond";
import { paginationSchema } from "@/lib/modules/shared/list-query";
import * as tasks from "@/lib/modules/tasks/task.service";

type Params = { params: Promise<{ taskId: string }> };

/** Task history, gated on task.activity.view plus task access (PRD #11 §78). */
export async function GET(request: Request, { params }: Params) {
  const { taskId } = await params;
  return withContext(async (context) => {
    const url = new URL(request.url);
    const { page, limit } = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return apiOk(await tasks.listActivity(context, taskId, { page, limit }));
  });
}
