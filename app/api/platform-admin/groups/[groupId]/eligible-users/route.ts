import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { eligibleGroupUsers } from "@/lib/modules/platform/platform-group-users.service";

type Params = { params: Promise<{ groupId: string }> };

/** Existing accounts of this group that may be given a group seat (Admin PRD #8 §29). */
export async function GET(request: Request, { params }: Params) {
  return withPlatformContext(async (context) => {
    const { groupId } = await params;
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return apiOk({ data: await eligibleGroupUsers(context, groupId, q) });
  });
}
