import { apiOk, withContext } from "@/lib/api/respond";
import { paginationSchema } from "@/lib/modules/shared/list-query";
import * as team from "@/lib/modules/team/team.service";

type Params = { params: Promise<{ memberId: string }> };

/** Membership history. Authentication events are not Team activity (PRD #14 §57). */
export async function GET(request: Request, { params }: Params) {
  const { memberId } = await params;
  return withContext(async (context) => {
    const url = new URL(request.url);
    const { page, limit } = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return apiOk(await team.listMemberActivity(context, memberId, { page, limit }));
  });
}
