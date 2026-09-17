import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { getGroupImplementation, activateParentGroup } from "@/lib/modules/platform/platform-implementation.service";

type Params = { params: Promise<{ groupId: string }> };

/** POST /api/platform/parent-groups/:groupId/activate — the group goes live; refused while the checklist blocks it (§21, §71). */
export async function POST(_request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => {
    await activateParentGroup(context, groupId);
    return apiOk({ data: await getGroupImplementation(context, groupId) });
  });
}
