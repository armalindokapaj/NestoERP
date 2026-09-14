import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { setPinned } from "@/lib/modules/announcements/announcement.publish";
import { versionSchema } from "@/lib/modules/announcements/announcement.schema";

type Params = { params: Promise<{ announcementId: string }> };

/** POST — unpin (PRD #45 §173). */
export async function POST(request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => {
    const input = versionSchema.parse(await readJson(request));
    return apiOk({ data: await setPinned(context, announcementId, false, input) });
  });
}
