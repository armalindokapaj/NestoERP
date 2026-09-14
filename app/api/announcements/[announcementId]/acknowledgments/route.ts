import { apiOk, withContext } from "@/lib/api/respond";
import { acknowledgmentList } from "@/lib/modules/announcements/announcement.service";

type Params = { params: Promise<{ announcementId: string }> };

/** GET — who has acknowledged and who is pending, for the author and its managers (PRD #45 §50, §177). */
export async function GET(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await acknowledgmentList(context, announcementId) }));
}
