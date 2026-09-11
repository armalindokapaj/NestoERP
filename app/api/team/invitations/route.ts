import { apiOk, readJson, withContext } from "@/lib/api/respond";
import * as invitations from "@/lib/modules/team/invitations/invite.service";
import { inviteMemberSchema } from "@/lib/modules/team/team.schema";

/**
 * GET  /api/team/invitations — the pending list (PRD #14 §150).
 * POST /api/team/invitations — invite somebody (PRD #14 §71).
 *
 * A failed email does not fail the request: the invitation is committed and
 * `delivered: false` says the message did not go out, so it can be resent
 * (PRD #14 §72).
 */
export async function GET() {
  return withContext(async (context) =>
    apiOk({ data: await invitations.listInvitations(context) }),
  );
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = inviteMemberSchema.parse(await readJson(request));
    return apiOk({ data: await invitations.inviteMember(context, input) }, { status: 201 });
  });
}
