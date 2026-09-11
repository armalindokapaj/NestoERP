import { apiOk, withContext } from "@/lib/api/respond";
import { listNotifications } from "@/lib/core/notifications/notification.service";

/** GET /api/notifications — the current member's own notifications (PRD #25 §148). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const readState = params.get("readState");
    return apiOk(
      await listNotifications(context, {
        readState: readState === "UNREAD" || readState === "READ" ? readState : undefined,
        page: Number(params.get("page") ?? 1),
        limit: Number(params.get("limit") ?? 25),
      }),
    );
  });
}
