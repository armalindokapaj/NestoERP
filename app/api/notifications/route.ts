import { z } from "zod";

import { apiOk, withContext } from "@/lib/api/respond";
import { listNotifications } from "@/lib/core/notifications/notification.service";

const querySchema = z.object({
  readState: z.enum(["UNREAD", "READ"]).optional(),
  before: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/notifications — the current member's own notifications, newest first by cursor (PRD #38 §72, §73). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({
      readState: params.get("readState") ?? undefined,
      before: params.get("before") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    return apiOk(await listNotifications(context, query));
  });
}
