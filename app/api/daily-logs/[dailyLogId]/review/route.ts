import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reviewDailyLog } from "@/lib/modules/daily-logs/daily-log.review";
import { transitionSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string }> };

/** POST — review the log, with the version the reader was looking at (PRD #43 §91-§94, §173-§176, §244). */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = transitionSchema.parse(await readJson(request));
    return apiOk({ data: (await reviewDailyLog(context, dailyLogId, input)) ?? { ok: true } });
  });
}
