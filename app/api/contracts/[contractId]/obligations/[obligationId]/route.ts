import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { obligationSchema } from "@/lib/modules/contracts/obligations/obligation.schema";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";

type Params = { params: Promise<{ obligationId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { obligationId } = await params;
    return apiOk({ data: await obligations.getObligation(context, obligationId) });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { obligationId } = await params;
    const input = obligationSchema.parse(await readJson(request));
    return apiOk({ data: await obligations.updateObligation(context, obligationId, input) });
  });
}
