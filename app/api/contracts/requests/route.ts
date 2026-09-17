import { apiOk, withContext } from "@/lib/api/respond";
import { parseContractRequestQuery } from "@/lib/modules/contracts/units/unit-contract.schema";
import { listContractRequests } from "@/lib/modules/contracts/units/unit-contract.service";

/** GET — Legal's queue of contract requests for units the reader may open, oldest first (E-05F §12). */
export async function GET(request: Request) {
  return withContext(async (context) => apiOk({ data: await listContractRequests(context, parseContractRequestQuery(new URL(request.url).searchParams)) }));
}
