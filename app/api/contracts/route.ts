import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createContractSchema } from "@/lib/modules/contracts/contracts/contract.schema";
import * as contracts from "@/lib/modules/contracts/contracts/contract.service";
import { parseContractQuery } from "@/lib/modules/contracts/contract.query";

/**
 * GET  /api/contracts — scoped, filtered, paginated (PRD #18 §261, §267).
 * POST /api/contracts — draft an agreement.
 *
 * `status` is absent from the request body: a contract is created as a draft
 * and moves through named lifecycle endpoints (PRD #18 §192, §269).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await contracts.listContracts(context, parseContractQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createContractSchema.parse(await readJson(request));
    return apiOk({ data: await contracts.createContract(context, input) }, { status: 201 });
  });
}
