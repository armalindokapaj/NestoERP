import { apiOk, withContext } from "@/lib/api/respond";
import * as invitations from "@/lib/modules/team/invitations/invite.service";

type Params = { params: Promise<{ inviteId: string }> };

/** Resending issues a new token and invalidates the previous one (PRD #14 §79). */
export async function POST(_request: Request, { params }: Params) {
  const { inviteId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await invitations.resendInvitation(context, inviteId) }),
  );
}
