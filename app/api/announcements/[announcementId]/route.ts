import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateAnnouncementSchema } from "@/lib/modules/announcements/announcement.schema";
import { getAnnouncement, updateAnnouncement } from "@/lib/modules/announcements/announcement.service";

type Params = { params: Promise<{ announcementId: string }> };

/** GET — one announcement, if it is addressed to this reader or theirs to manage; otherwise not found (PRD #45 §158, §167). */
export async function GET(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await getAnnouncement(context, announcementId) }));
}

/** PATCH — edit, with the version the editor loaded (PRD #45 §145-§153, §169, §293). */
export async function PATCH(request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => {
    const input = updateAnnouncementSchema.parse(await readJson(request));
    return apiOk({ data: await updateAnnouncement(context, announcementId, input) });
  });
}
