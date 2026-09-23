import { apiOk, withContext } from "@/lib/api/respond";
import { markAnnouncementSeen } from "@/lib/modules/activity/activity-center.service";

type Params = { params: Promise<{ announcementId: string }> };

/**
 * POST — the person has seen this announcement (Activity Center §44, §55, §72).
 * Seen is not acknowledged (§11). Found through whichever of the person's
 * memberships it reaches them in, so it works from any workspace; idempotent.
 * Group workspace: `any`.
 */
export async function POST(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await markAnnouncementSeen(context, announcementId) }), { group: "any" });
}
