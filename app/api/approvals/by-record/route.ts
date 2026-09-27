import { apiOk, withContext } from "@/lib/api/respond";
import { providerKeySchema } from "@/lib/modules/approvals/approvals.schema";
import { findApprovalForRecord } from "@/lib/modules/approvals/approvals.service";

/**
 * GET /api/approvals/by-record?type=&id=[&provider=] — the approval on a record,
 * as `provider:approvalId`, for links that name the record (PRD #41 §42). Null
 * when there is none this reader can open.
 *
 * `provider` says which source the link is about where two decide the same
 * record type — a unit's publishing and its sale (AUD-10 §4, A7); an unknown
 * value is ignored rather than trusted. A source that could not be read answers
 * 503 APPROVAL_SOURCE_UNAVAILABLE, never "no approval".
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const type = (params.get("type") ?? "").slice(0, 40);
    const id = (params.get("id") ?? "").slice(0, 64);
    const provider = providerKeySchema.safeParse(params.get("provider"));
    return apiOk({ data: type && id ? await findApprovalForRecord(context, type, id, { providerKey: provider.success ? provider.data : null }) : null });
  });
}
