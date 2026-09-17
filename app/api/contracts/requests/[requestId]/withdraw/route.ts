import { apiOk, withContext } from "@/lib/api/respond";
import { withdrawContractRequest } from "@/lib/modules/contracts/units/unit-contract.service";

type Params = { params: Promise<{ requestId: string }> };

/** POST — Sales takes back a request Legal has not answered (E-05F §12). */
export async function POST(_request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => {
    await withdrawContractRequest(context, requestId);
    return apiOk({ data: { ok: true } });
  });
}
