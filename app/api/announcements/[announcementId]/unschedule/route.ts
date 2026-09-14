import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { unscheduleAnnouncement } from "@/lib/modules/announcements/announcement.publish";
import { versionSchema } from "@/lib/modules/announcements/announcement.schema";

type Params = { params: Promise<{ announcementId: string }> };

/** POST — cancel a schedule back to a draft (PRD #45 §155). */
export async function POST(request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => {
    const input = versionSchema.parse(await readJson(request));
    return apiOk({ data: await unscheduleAnnouncement(context, announcementId, input) });
  });
}
