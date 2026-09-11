import { apiOk, withContext } from "@/lib/api/respond";
import * as team from "@/lib/modules/team/team.service";

type Params = { params: Promise<{ memberId: string }> };

/**
 * A member's projects, narrowed to the reader's own project scope: the count
 * shown is what they can open, never the company total (PRD #14 §51, §52).
 */
export async function GET(_request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await team.listMemberProjects(context, memberId) }),
  );
}
