import { apiOk, withContext } from "@/lib/api/respond";
import { parseObligationQuery } from "@/lib/modules/contracts/contract.query";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";

/** The obligation register across every contract in scope (PRD #18 §222). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await obligations.listObligations(context, parseObligationQuery(url.searchParams)));
  });
}
