import { z } from "zod";

import { apiOk, withContext } from "@/lib/api/respond";
import { listNotificationsForWorkspace } from "@/lib/core/notifications/notification.service";

const querySchema = z.object({
  readState: z.enum(["UNREAD", "READ"]).optional(),
  before: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/notifications — the current member's own notifications, newest first by cursor (PRD #38 §72, §73).
 *
 * Group workspace: `read`. Notifications are the person's own, not a company's
 * list, so the Group workspace shows the ones they hold in every company they
 * may use, each row naming its company (Workspace Context §45). The rows come
 * from the person's own memberships — resolved server-side, never from the
 * request — and each company's own module switches narrow its own rows.
 */
export async function GET(request: Request) {
  return withContext(
    async (context) => {
      const params = new URL(request.url).searchParams;
      const query = querySchema.parse({
        readState: params.get("readState") ?? undefined,
        before: params.get("before") ?? undefined,
        limit: params.get("limit") ?? undefined,
      });
      return apiOk(await listNotificationsForWorkspace(context, query));
    },
    { group: "read" },
  );
}
