import { apiOk, withGroupContext } from "@/lib/api/respond";
import { groupActor } from "@/lib/modules/platform/group-actor";
import { eligibleGroupUsers } from "@/lib/modules/platform/platform-group-users.service";

/** Existing accounts of the caller's own group that may be given a group seat (Admin PRD #8 §29). */
export async function GET(request: Request) {
  return withGroupContext(async (context) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return apiOk({ data: await eligibleGroupUsers(groupActor(context), context.groupId, q) });
  });
}
