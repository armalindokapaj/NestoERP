import { apiOk, withContext } from "@/lib/api/respond";
import { markAllActivityRead } from "@/lib/modules/activity/activity-center.service";

/**
 * POST — mark every eligible notification read and every live announcement
 * seen; never acknowledges anything (Activity Center §29, §186, §196).
 * Group workspace: `any` — the person's own read state, nobody else's.
 */
export async function POST() {
  return withContext(async (context) => apiOk({ data: await markAllActivityRead(context) }), { group: "any" });
}
