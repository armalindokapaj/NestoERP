import { apiOk, withContext } from "@/lib/api/respond";
import { duplicateAnnouncement } from "@/lib/modules/announcements/announcement.service";

type Params = { params: Promise<{ announcementId: string }> };

/** POST — copy content and audience into a new draft (PRD #45 §225). */
export async function POST(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await duplicateAnnouncement(context, announcementId) }));
}
