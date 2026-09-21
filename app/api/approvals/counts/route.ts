import { apiOk, withContext } from "@/lib/api/respond";
import { getApprovalCountsForWorkspace } from "@/lib/modules/approvals/approvals.group";

/**
 * GET /api/approvals/counts — what waits on this person, overdue and critical (PRD #41 §96).
 * In the Group workspace: the sum over the companies they may read, and each company's own
 * figures under `byCompany` (Workspace Context §33).
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getApprovalCountsForWorkspace(context) }), { group: "read" });
}
