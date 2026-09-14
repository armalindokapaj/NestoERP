import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { scheduleAnnouncement } from "@/lib/modules/announcements/announcement.publish";
import { scheduleSchema } from "@/lib/modules/announcements/announcement.schema";

type Params = { params: Promise<{ announcementId: string }> };

/** POST — publish later; the worker publishes it once when due (PRD #45 §21, §171). */
export async function POST(request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => {
    const input = scheduleSchema.parse(await readJson(request));
    return apiOk({ data: await scheduleAnnouncement(context, announcementId, input) });
  });
}
