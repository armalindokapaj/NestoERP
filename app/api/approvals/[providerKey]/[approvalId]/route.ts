import { apiOk, withContext } from "@/lib/api/respond";
import { getApprovalDetail } from "@/lib/modules/approvals/approvals.service";

type Params = { params: Promise<{ providerKey: string; approvalId: string }> };

/** GET /api/approvals/:providerKey/:approvalId — the review drawer's content (PRD #41 §115). */
export async function GET(_request: Request, { params }: Params) {
  const { providerKey, approvalId } = await params;
  return withContext(async (context) => apiOk({ data: await getApprovalDetail(context, providerKey, approvalId) }));
}
