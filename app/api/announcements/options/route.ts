import { apiOk, withContext } from "@/lib/api/respond";
import { announcementOptions } from "@/lib/modules/announcements/announcement.service";

/** GET — the audiences, projects, departments and people this author could address. */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await announcementOptions(context) }));
}
