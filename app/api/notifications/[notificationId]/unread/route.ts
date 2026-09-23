import { withContext } from "@/lib/api/respond";
import { markReadForWorkspace } from "@/lib/core/notifications/notification.service";

type Params = { params: Promise<{ notificationId: string }> };

/** POST — mark one of the person's own notifications unread again (Activity Center §71); another's answers 404. Group workspace: `any`. */
export async function POST(_request: Request, { params }: Params) {
  const { notificationId } = await params;
  return withContext(
    async (context) => {
      await markReadForWorkspace(context, notificationId, false);
      return new Response(null, { status: 204 });
    },
    { group: "any" },
  );
}
