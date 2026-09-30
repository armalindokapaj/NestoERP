import { apiOk, withContext } from "@/lib/api/respond";
import { buildAuthorizationSnapshot } from "@/lib/core/sync/authorization.service";

/** GET /api/sync/authorization — the snapshot a device keeps for offline use and its lifetime (MOB-09 §56, §62). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: buildAuthorizationSnapshot(context) }), { group: "read" });
}
