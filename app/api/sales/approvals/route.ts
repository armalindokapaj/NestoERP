import { apiOk, withContext } from "@/lib/api/respond";
import * as approvals from "@/lib/modules/sales/approvals/approval.service";

/**
 * The proposal approval queue (PRD #17 §132).
 *
 * Scoped by resolving the proposals the caller can reach, so the queue cannot
 * become a back door onto deals they may not open.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    return apiOk(
      await approvals.listApprovals(context, {
        status: status === "DECIDED" ? "DECIDED" : status === "PENDING" ? "PENDING" : undefined,
        page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
        limit: Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25,
      }),
    );
  });
}
