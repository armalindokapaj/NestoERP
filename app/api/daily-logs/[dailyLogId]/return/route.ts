import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { returnDailyLog } from "@/lib/modules/daily-logs/daily-log.review";
import { reasonSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string }> };

/** POST — return the log; a reason is required (PRD #43 §93, §95, §175, §177). */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = reasonSchema.parse(await readJson(request));
    await returnDailyLog(context, dailyLogId, input);
    return apiOk({ data: { ok: true } });
  });
}
