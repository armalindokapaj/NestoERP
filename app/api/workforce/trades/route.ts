import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createTradeSchema } from "@/lib/modules/workforce/workforce.schema";
import { createTrade, listTrades } from "@/lib/modules/workforce/trade.service";

/**
 * GET  /api/workforce/trades — the company's trades, with how many employees
 *      and crews have each (E-04 §11).
 * POST /api/workforce/trades — add one.
 *
 * Both work in the session's company and need `workforce.trade.manage`.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listTrades(context) }));
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createTradeSchema.parse(await readJson(request));
    return apiOk({ data: await createTrade(context, input) }, { status: 201 });
  });
}
