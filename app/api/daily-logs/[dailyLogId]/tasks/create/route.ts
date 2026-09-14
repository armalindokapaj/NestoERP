import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createTaskFromLog } from "@/lib/modules/daily-logs/daily-log.links";
import { createTaskFromLogSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string }> };

/** POST — raise a follow-up task through the task service (PRD #43 §61, §73, §180). */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = createTaskFromLogSchema.parse(await readJson(request));
    return apiOk({ data: await createTaskFromLog(context, dailyLogId, input) }, { status: 201 });
  });
}
