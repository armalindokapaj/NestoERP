import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { getGroupImplementation, markReadyForValidation } from "@/lib/modules/platform/platform-implementation.service";

type Params = { params: Promise<{ groupId: string }> };

/** POST /api/platform/parent-groups/:groupId/ready — the implementation goes to the Owner for validation (§21). */
export async function POST(_request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => {
    await markReadyForValidation(context, groupId);
    return apiOk({ data: await getGroupImplementation(context, groupId) });
  });
}
