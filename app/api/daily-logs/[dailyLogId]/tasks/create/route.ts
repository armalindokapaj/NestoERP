import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createTaskFromLog } from "@/lib/modules/daily-logs/daily-log.links";
import { createTaskFromLogSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string }> };

/** POST — raise a follow-up task through the task service (PRD #43 §61, §73, §180); 201 when created, 200 on a retry. */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = createTaskFromLogSchema.parse(await readJson(request));
    const result = await createTaskFromLog(context, dailyLogId, input);
    // A retry of an entry already raised answers the same task, not a new one (AUD-10 §5, CW-07).
    return apiOk({ data: result }, { status: result.created ? 201 : 200 });
  });
}
