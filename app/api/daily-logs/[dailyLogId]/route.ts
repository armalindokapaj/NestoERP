import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateDailyLogSchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { getDailyLog, updateDailyLog } from "@/lib/modules/daily-logs/daily-log.service";

type Params = { params: Promise<{ dailyLogId: string }> };

/** GET — one log, if this reader can open its project; otherwise not found (PRD #43 §164, §229). */
export async function GET(_request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => apiOk({ data: await getDailyLog(context, dailyLogId) }));
}

/** PATCH — the summary, notes and site condition, with the version the form loaded (PRD #43 §165). */
export async function PATCH(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = updateDailyLogSchema.parse(await readJson(request));
    return apiOk({ data: await updateDailyLog(context, dailyLogId, input) });
  });
}
