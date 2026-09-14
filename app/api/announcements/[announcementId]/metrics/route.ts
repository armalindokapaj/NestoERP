import { apiOk, withContext } from "@/lib/api/respond";
import { announcementMetrics } from "@/lib/modules/announcements/announcement.service";

type Params = { params: Promise<{ announcementId: string }> };

/** GET — audience, read, acknowledged and pending, for the author and its managers (PRD #45 §48, §176). */
export async function GET(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await announcementMetrics(context, announcementId) }));
}
