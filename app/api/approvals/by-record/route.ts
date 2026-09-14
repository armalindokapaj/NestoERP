import { apiOk, withContext } from "@/lib/api/respond";
import { findApprovalForRecord } from "@/lib/modules/approvals/approvals.service";

/**
 * GET /api/approvals/by-record?type=&id= — the approval on a record, as
 * `provider:approvalId`, for links that name the record (PRD #41 §42). Null
 * when there is none this reader can open.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const type = (params.get("type") ?? "").slice(0, 40);
    const id = (params.get("id") ?? "").slice(0, 64);
    return apiOk({ data: type && id ? await findApprovalForRecord(context, type, id) : null });
  });
}
