import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { publishAnnouncement } from "@/lib/modules/announcements/announcement.publish";
import { versionSchema } from "@/lib/modules/announcements/announcement.schema";

type Params = { params: Promise<{ announcementId: string }> };

/** POST — publish now: audience checked again, targets captured, audit and notifications written together (PRD #45 §142, §170). */
export async function POST(request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => {
    const input = versionSchema.parse(await readJson(request));
    return apiOk({ data: await publishAnnouncement(context, announcementId, input) });
  });
}
