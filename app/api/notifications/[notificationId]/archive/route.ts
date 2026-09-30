import { withContext } from "@/lib/api/respond";
import { archiveNotificationForWorkspace } from "@/lib/core/notifications/notification.service";

type Params = { params: Promise<{ notificationId: string }> };

/**
 * POST /api/notifications/:id/archive — move one of the caller's own notifications out of the inbox (MOB-10 §126).
 * The business record is not touched. Somebody else's notification answers 404. Personal and company-less, like reading.
 */
export async function POST(_request: Request, { params }: Params) {
  const { notificationId } = await params;
  return withContext(
    async (context) => {
      await archiveNotificationForWorkspace(context, notificationId);
      return new Response(null, { status: 204 });
    },
    { group: "any" },
  );
}
