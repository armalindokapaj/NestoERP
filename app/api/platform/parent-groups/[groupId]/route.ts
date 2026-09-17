import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { getGroupImplementation, updateParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { updateParentGroupSchema } from "@/lib/modules/platform/platform.schema";

type Params = { params: Promise<{ groupId: string }> };

/** GET, PATCH /api/platform/parent-groups/:groupId — the group's implementation, and its identity while implementing (E-06 §86). */
export async function GET(_request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => apiOk({ data: await getGroupImplementation(context, groupId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => {
    const input = updateParentGroupSchema.parse(await readJson(request));
    await updateParentGroup(context, groupId, input);
    return apiOk({ data: await getGroupImplementation(context, groupId) });
  });
}
