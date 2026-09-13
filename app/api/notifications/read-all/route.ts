import { apiOk, withContext } from "@/lib/api/respond";
import { markAllRead } from "@/lib/core/notifications/notification.service";

/**
 * POST /api/notifications/read-all — clear the reader's own unread count
 * (PRD #25 §157).
 *
 * Scoped to the caller's membership by the service, so "all" can only ever
 * mean their own.
 */
export async function POST() {
  return withContext(async (context) => apiOk({ data: { read: await markAllRead(context) } }));
}
