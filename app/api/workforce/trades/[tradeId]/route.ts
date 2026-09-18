import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateTradeSchema } from "@/lib/modules/workforce/workforce.schema";
import { deleteTrade, updateTrade } from "@/lib/modules/workforce/trade.service";

type Params = { params: Promise<{ tradeId: string }> };

/**
 * PATCH  /api/workforce/trades/:tradeId — rename, recode, retire or bring back (E-04 §11).
 * DELETE /api/workforce/trades/:tradeId — only a trade nobody has been given.
 *
 * A trade of another company answers 404, the same as one that does not exist.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { tradeId } = await params;
  return withContext(async (context) => {
    const input = updateTradeSchema.parse(await readJson(request));
    return apiOk({ data: await updateTrade(context, tradeId, input) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { tradeId } = await params;
  return withContext(async (context) => {
    await deleteTrade(context, tradeId);
    return apiOk({ data: { deleted: true } });
  });
}
