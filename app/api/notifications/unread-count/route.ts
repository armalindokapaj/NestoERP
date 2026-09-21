import { apiOk, withContext } from "@/lib/api/respond";
import { getUnreadCountForWorkspace } from "@/lib/core/notifications/notification.service";

/**
 * GET /api/notifications/unread-count — polled by the top bar, so it stays a
 * pair of indexed counts and nothing more (PRD #25 §148, §328, §331).
 *
 * Group workspace: `read`. The bell follows the workspace: in the Group
 * workspace it counts the person's own unread notifications across the
 * companies they may use, each narrowed by that company's own module switches
 * (Workspace Context §45).
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getUnreadCountForWorkspace(context) }), { group: "read" });
}
