import { apiOk, withContext } from "@/lib/api/respond";
import { parseTeamListQuery } from "@/lib/modules/team/team.query";
import * as team from "@/lib/modules/team/team.service";

/** GET /api/team — the scoped company directory (PRD #14 §149, §152). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await team.listMembers(context, parseTeamListQuery(url.searchParams)));
  });
}
