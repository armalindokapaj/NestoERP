import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { obligationCloseSchema } from "@/lib/modules/contracts/obligations/obligation.schema";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";

type Params = { params: Promise<{ obligationId: string }> };

/** The requirement has been met (PRD #18 §156). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { obligationId } = await params;
    const { note } = obligationCloseSchema.parse(await readJson(request));
    await obligations.completeObligation(context, obligationId, note ?? null);
    return apiOk({ data: { ok: true } });
  });
}
