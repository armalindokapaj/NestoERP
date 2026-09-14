import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { linkTask } from "@/lib/modules/daily-logs/daily-log.links";
import { linkTaskSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string }> };

/** POST — link an existing task on the log's project (PRD #43 §71, §179). */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = linkTaskSchema.parse(await readJson(request));
    return apiOk({ data: await linkTask(context, dailyLogId, input) }, { status: 201 });
  });
}
