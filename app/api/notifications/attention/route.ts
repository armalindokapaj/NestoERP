import { apiOk, withContext } from "@/lib/api/respond";
import { listReadableAttention } from "@/lib/core/notifications/attention.service";

/**
 * GET /api/notifications/attention — unresolved conditions for this member,
 * each record re-read in their context first. The raw rows are a note of what
 * was detected, never proof of current access (PRD #38 §82, PRD #47 §77).
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listReadableAttention(context) }));
}
