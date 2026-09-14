import { apiOk, withContext } from "@/lib/api/respond";
import { recordCandidates } from "@/lib/modules/daily-logs/daily-log.links";

type Params = { params: Promise<{ dailyLogId: string }> };

/** GET — QA/QC and HSE records on the project around the log's day that this reader could link. */
export async function GET(_request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => apiOk({ data: await recordCandidates(context, dailyLogId) }));
}
