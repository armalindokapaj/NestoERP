import { apiOk, withContext } from "@/lib/api/respond";
import * as approvals from "@/lib/modules/contracts/approvals/approval.service";

/**
 * The approval queue (PRD #18 §185, §265).
 *
 * Contracts and amendments in one list, each reachable only through the
 * contract it belongs to.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);

    return apiOk(
      await approvals.listApprovals(context, {
        status: status === "DECIDED" ? "DECIDED" : status === "PENDING" ? "PENDING" : undefined,
        page: Number.isFinite(page) && page > 0 ? page : 1,
      }),
    );
  });
}
