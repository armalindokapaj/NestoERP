import { apiOk, withContext } from "@/lib/api/respond";
import { unlinkTask } from "@/lib/modules/daily-logs/daily-log.links";

type Params = { params: Promise<{ dailyLogId: string; linkId: string }> };

/** DELETE — unlink a task; the task itself is untouched. */
export async function DELETE(_request: Request, { params }: Params) {
  const { dailyLogId, linkId } = await params;
  return withContext(async (context) => apiOk({ data: await unlinkTask(context, dailyLogId, linkId) }));
}
