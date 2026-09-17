import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { declineRequestSchema } from "@/lib/modules/contracts/units/unit-contract.schema";
import { declineContractRequest } from "@/lib/modules/contracts/units/unit-contract.service";

type Params = { params: Promise<{ requestId: string }> };

/** POST — Legal declines a contract request, with a reason Sales is told (E-05F §12). */
export async function POST(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => {
    const input = declineRequestSchema.parse(await readJson(request));
    await declineContractRequest(context, requestId, input);
    return apiOk({ data: { ok: true } });
  });
}
