import { apiOk, withContext } from "@/lib/api/respond";
import { acknowledgeAnnouncement } from "@/lib/modules/announcements/announcement.service";

type Params = { params: Promise<{ announcementId: string }> };

/** POST — "I have read this" for the member asking, never another; idempotent (PRD #45 §159, §175). */
export async function POST(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await acknowledgeAnnouncement(context, announcementId) }));
}
