import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { createGroupCompany } from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema } from "@/lib/modules/platform/platform.schema";

type Params = { params: Promise<{ groupId: string }> };

/** POST /api/platform/parent-groups/:groupId/companies — a new company of the group (E-06 §34, §35, §87). */
export async function POST(request: Request, { params }: Params) {
  const { groupId } = await params;
  return withPlatformContext(async (context) => {
    const input = createGroupCompanySchema.parse(await readJson(request));
    return apiOk({ data: await createGroupCompany(context, groupId, input) }, { status: 201 });
  });
}
