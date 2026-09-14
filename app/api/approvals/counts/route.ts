import { apiOk, withContext } from "@/lib/api/respond";
import { getApprovalCounts } from "@/lib/modules/approvals/approvals.service";

/** GET /api/approvals/counts — what waits on this person, overdue and critical (PRD #41 §96). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getApprovalCounts(context) }));
}
