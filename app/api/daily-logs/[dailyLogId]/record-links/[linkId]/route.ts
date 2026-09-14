import { apiOk, withContext } from "@/lib/api/respond";
import { unlinkRecord } from "@/lib/modules/daily-logs/daily-log.links";

type Params = { params: Promise<{ dailyLogId: string; linkId: string }> };

/** DELETE — stop referencing a QA/QC or HSE record. */
export async function DELETE(_request: Request, { params }: Params) {
  const { dailyLogId, linkId } = await params;
  return withContext(async (context) => apiOk({ data: await unlinkRecord(context, dailyLogId, linkId) }));
}
