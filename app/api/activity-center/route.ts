import { apiOk, withContext, withMeta } from "@/lib/api/respond";
import { timeActivityRead } from "@/lib/core/observability/navigation-telemetry";
import { activityFilters, activityQuerySchema } from "@/lib/modules/activity/activity-center.schema";
import { listActivity } from "@/lib/modules/activity/activity-center.service";

/**
 * GET — the Activity Center stream: the person's own notifications and the
 * live announcements addressed to them, merged newest first, by cursor
 * (Activity Center §7, §8, §73-§75).
 *
 * Group workspace: `read`. The bell is user-global (§31, §78): every company of
 * the person's group they may use, whatever the workspace. A company filter
 * naming a company they may not use is refused, never answered empty (§142).
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const input = activityQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      return apiOk(await withMeta(context, timeActivityRead("list", () => listActivity(context, activityFilters(input)))));
    },
    { group: "read" },
  );
}
