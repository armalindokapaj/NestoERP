import { apiOk, withContext } from "@/lib/api/respond";
import { markRead } from "@/lib/modules/announcements/announcement.service";

type Params = { params: Promise<{ announcementId: string }> };

/** POST — record that this member opened it, once the detail has loaded; idempotent (PRD #45 §174, §212). */
export async function POST(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await markRead(context, announcementId) }));
}
