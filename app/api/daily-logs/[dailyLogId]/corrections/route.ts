import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { addCorrection } from "@/lib/modules/daily-logs/daily-log.review";
import { correctionSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string }> };

/** POST — append an official correction to a locked log (PRD #43 §97-§102, §178). */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = correctionSchema.parse(await readJson(request));
    return apiOk({ data: await addCorrection(context, dailyLogId, input) }, { status: 201 });
  });
}
