import { apiOk, withContext } from "@/lib/api/respond";
import { markAllReadForWorkspace } from "@/lib/core/notifications/notification.service";

/**
 * POST /api/notifications/read-all — clear the reader's own unread count
 * (PRD #25 §157).
 *
 * Scoped to the caller's membership by the service, so "all" can only ever
 * mean their own.
 *
 * Group workspace: `any`. It is the person's own light write with no company to
 * get wrong: "all" is their own unread rows in each company they may use — the
 * ones the Group list shows — and nobody else's (Workspace Context §45).
 */
export async function POST() {
  return withContext(async (context) => apiOk({ data: { read: await markAllReadForWorkspace(context) } }), { group: "any" });
}
