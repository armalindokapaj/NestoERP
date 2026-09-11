import { apiOk, withContext } from "@/lib/api/respond";
import { getUnreadCount } from "@/lib/core/notifications/notification.service";

/**
 * GET /api/notifications/unread-count — polled by the top bar, so it stays a
 * pair of indexed counts and nothing more (PRD #25 §148, §328, §331).
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getUnreadCount(context) }));
}
