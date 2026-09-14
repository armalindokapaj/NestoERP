import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { archiveAnnouncement } from "@/lib/modules/announcements/announcement.publish";
import { versionSchema } from "@/lib/modules/announcements/announcement.schema";

type Params = { params: Promise<{ announcementId: string }> };

/** POST — archive; it leaves every feed and stays on record (PRD #45 §144, §172). */
export async function POST(request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => {
    const input = versionSchema.parse(await readJson(request));
    return apiOk({ data: await archiveAnnouncement(context, announcementId, input) });
  });
}
