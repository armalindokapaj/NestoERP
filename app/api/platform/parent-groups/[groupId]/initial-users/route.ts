import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { provisionInitialUser } from "@/lib/modules/platform/platform-implementation.service";
import { initialUserSchema } from "@/lib/modules/platform/platform.schema";

type Params = { params: Promise<{ groupId: string }> };

/**
 * POST /api/platform/parent-groups/:groupId/initial-users — one person of the
 * approved initial roster, while the group is implementing (E-06 §30, §60, §138).
 * The temporary password is in this response and nowhere else.
 */
export async function POST(request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => {
    const input = initialUserSchema.parse(await readJson(request));
    return apiOk({ data: await provisionInitialUser(context, groupId, input) }, { status: 201 });
  });
}
