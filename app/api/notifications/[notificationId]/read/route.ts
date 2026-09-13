import { readJson, withContext } from "@/lib/api/respond";
import { markRead } from "@/lib/core/notifications/notification.service";

type Params = { params: Promise<{ notificationId: string }> };

/**
 * POST /api/notifications/:id/read — mark one notification read or unread
 * (PRD #25 §157, §165).
 *
 * Only the recipient may change their own read state. Somebody else's
 * notification answers 404 rather than 403, so the endpoint cannot be used to
 * discover that a notification exists.
 */
export async function POST(request: Request, { params }: Params) {
  const { notificationId } = await params;
  return withContext(async (context) => {
    const body = (await readJson(request)) as { read?: unknown };
    await markRead(context, notificationId, body?.read !== false);
    return new Response(null, { status: 204 });
  });
}
