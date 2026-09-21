import { readJson, withContext } from "@/lib/api/respond";
import { markReadForWorkspace } from "@/lib/core/notifications/notification.service";

type Params = { params: Promise<{ notificationId: string }> };

/**
 * POST /api/notifications/:id/read — mark one notification read or unread
 * (PRD #25 §157, §165).
 *
 * Only the recipient may change their own read state. Somebody else's
 * notification answers 404 rather than 403, so the endpoint cannot be used to
 * discover that a notification exists.
 *
 * Group workspace: `any`. It is the person's own light write with no company to
 * get wrong: the row is found among their own notifications in the companies
 * they may use and only that row changes, whichever company sent it
 * (Workspace Context §45).
 */
export async function POST(request: Request, { params }: Params) {
  const { notificationId } = await params;
  return withContext(
    async (context) => {
      const body = (await readJson(request)) as { read?: unknown };
      await markReadForWorkspace(context, notificationId, body?.read !== false);
      return new Response(null, { status: 204 });
    },
    { group: "any" },
  );
}
