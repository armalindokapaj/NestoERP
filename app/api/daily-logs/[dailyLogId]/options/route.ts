import { apiOk, withContext } from "@/lib/api/respond";
import { entryOptions } from "@/lib/modules/daily-logs/daily-log.links";

type Params = { params: Promise<{ dailyLogId: string }> };

/** GET — suppliers, orders, receipts, tasks and people the section forms may offer this writer. */
export async function GET(_request: Request, { params }: Params) {
  const { dailyLogId } = await params;
  return withContext(async (context) => apiOk({ data: await entryOptions(context, dailyLogId) }));
}
