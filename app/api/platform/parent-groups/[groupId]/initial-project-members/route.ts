import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { assignInitialProjectMember } from "@/lib/modules/platform/platform-implementation.service";
import { initialProjectMemberSchema } from "@/lib/modules/platform/platform.schema";

type Params = { params: Promise<{ groupId: string }> };

/** POST /api/platform/parent-groups/:groupId/initial-project-members — a first project assignment from the roster (E-06 §30, §138). */
export async function POST(request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => {
    const input = initialProjectMemberSchema.parse(await readJson(request));
    await assignInitialProjectMember(context, groupId, input);
    return apiOk({ data: { ok: true } }, { status: 201 });
  });
}
