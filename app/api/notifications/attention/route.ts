import { apiOk, withContext } from "@/lib/api/respond";
import { listActiveAttention } from "@/lib/core/notifications/attention.service";

/** GET /api/notifications/attention — unresolved conditions for this member. */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listActiveAttention(context) }));
}
