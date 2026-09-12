import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { obligationCloseSchema } from "@/lib/modules/contracts/obligations/obligation.schema";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";

type Params = { params: Promise<{ obligationId: string }> };

/** The requirement no longer applies (PRD #18 §157). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { obligationId } = await params;
    const { note } = obligationCloseSchema.parse(await readJson(request));
    await obligations.cancelObligation(context, obligationId, note ?? null);
    return apiOk({ data: { ok: true } });
  });
}
