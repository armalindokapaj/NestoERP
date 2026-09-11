import { withContext } from "@/lib/api/respond";
import * as team from "@/lib/modules/team/team.service";

type Params = { params: Promise<{ memberId: string }> };

/**
 * Its own endpoint: membership status is never something a PATCH may set, and
 * removing access revokes the sessions that carry it (PRD #14 §155, §243).
 */
export async function POST(_request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => {
    await team.suspendMember(context, memberId);
    return new Response(null, { status: 204 });
  });
}
