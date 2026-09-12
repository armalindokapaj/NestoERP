import { apiOk, withContext } from "@/lib/api/respond";
import { listRecordActivity } from "@/lib/modules/contracts/contract.activity";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";

type Params = { params: Promise<{ contractId: string }> };

/**
 * The contract's history (PRD #18 §209, §210).
 *
 * The contract is fetched first, so activity is only readable by somebody who
 * can already reach the record it describes.
 */
export async function GET(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { contractId } = await params;
    await contracts.getContract(context, contractId);

    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);

    return apiOk(
      await listRecordActivity(context, "Contract", contractId, {
        page: Number.isFinite(page) && page > 0 ? page : 1,
      }),
    );
  });
}
