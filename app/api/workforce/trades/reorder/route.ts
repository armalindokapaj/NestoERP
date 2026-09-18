import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderTradesSchema } from "@/lib/modules/workforce/workforce.schema";
import { reorderTrades } from "@/lib/modules/workforce/trade.service";

/** POST /api/workforce/trades/reorder — every trade of the company, in the order forms offer them. */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const { ids } = reorderTradesSchema.parse(await readJson(request));
    return apiOk({ data: await reorderTrades(context, ids) });
  });
}
