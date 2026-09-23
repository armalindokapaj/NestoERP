import { apiOk, withContext } from "@/lib/api/respond";
import { markAnnouncementSeen } from "@/lib/modules/activity/activity-center.service";

type Params = { params: Promise<{ announcementId: string }> };

/**
 * POST — record that this member opened it, once the detail has loaded; idempotent (PRD #45 §174, §212).
 * The same "seen" as `/seen` (Activity Center §55): never an acknowledgment, and it reads the
 * notifications the announcement sent too. Group workspace: `any`.
 */
export async function POST(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await markAnnouncementSeen(context, announcementId) }), { group: "any" });
}
