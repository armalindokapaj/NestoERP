import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { linkRecord } from "@/lib/modules/daily-logs/daily-log.links";
import { recordLinkSchema } from "@/lib/modules/daily-logs/daily-log.schema";

type Params = { params: Promise<{ dailyLogId: string }> };

/** POST — reference a QA/QC or HSE record from the log; the record is not changed (PRD #43 §63, §64, §181, §182). */
export async function POST(request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => {
    const input = recordLinkSchema.parse(await readJson(request));
    return apiOk({ data: await linkRecord(context, dailyLogId, input) }, { status: 201 });
  });
}
