import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { voidDailyLog } from "@/lib/modules/daily-logs/daily-log.review";
import { reasonSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string }> };

/** POST — void the log; a reason is required (PRD #43 §93, §95, §175, §177). */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = reasonSchema.parse(await readJson(request));
    await voidDailyLog(context, dailyLogId, input);
    return apiOk({ data: { ok: true } });
  });
}
