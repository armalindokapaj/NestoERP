import { apiOk, withContext } from "@/lib/api/respond";
import { acknowledgeAnnouncementFor } from "@/lib/modules/activity/activity-center.service";

type Params = { params: Promise<{ announcementId: string }> };

/**
 * POST — "I have read this" for the member asking, never another; idempotent
 * (PRD #45 §159, §175; Activity Center §28, §72). Explicit only — neither
 * "seen" nor "mark all" ever acknowledges. Found through the person's own
 * membership that the announcement reaches, from any workspace. Group workspace: `any`.
 */
export async function POST(_request: Request, { params }: Params) {
  const { announcementId } = await params;
  return withContext(async (context) => apiOk({ data: await acknowledgeAnnouncementFor(context, announcementId) }), { group: "any" });
}
