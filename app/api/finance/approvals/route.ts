import { apiOk, withContext } from "@/lib/api/respond";
import * as approvals from "@/lib/modules/finance/approvals/approval.service";

/**
 * The approval queue (PRD #15 §141, §143).
 *
 * Scoped to the records this reader can reach, so a project-scoped approver
 * never sees a company invoice waiting in it.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);

    return apiOk(
      await approvals.listApprovals(context, {
        status: status === "DECIDED" ? "DECIDED" : "PENDING",
        page: Number.isFinite(page) && page > 0 ? page : 1,
        limit: 25,
      }),
    );
  });
}
