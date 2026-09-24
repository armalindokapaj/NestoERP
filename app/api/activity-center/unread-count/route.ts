import { apiOk, withContext, withMeta } from "@/lib/api/respond";
import { timeActivityRead } from "@/lib/core/observability/navigation-telemetry";
import { activityCounts } from "@/lib/modules/activity/activity-center.service";

/**
 * GET — the bell: unread notifications plus unseen announcements, each counted
 * once, nothing inaccessible counted (Activity Center §10, §76, §77, §184).
 * Polled, so it loads no bodies. Group workspace: `read`; user-global.
 */
export async function GET() {
  return withContext(async (context) => apiOk(await withMeta(context, timeActivityRead("count", () => activityCounts(context)))), { group: "read" });
}
