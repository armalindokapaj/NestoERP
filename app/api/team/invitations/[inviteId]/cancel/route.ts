import { withContext } from "@/lib/api/respond";
import * as invitations from "@/lib/modules/team/invitations/invite.service";

type Params = { params: Promise<{ inviteId: string }> };

/** A cancelled invitation can no longer be accepted (PRD #14 §80, §266). */
export async function POST(_request: Request, { params }: Params) {
  const { inviteId } = await params;
  return withContext(async (context) => {
    await invitations.cancelInvitation(context, inviteId);
    return new Response(null, { status: 204 });
  });
}
