import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { eligibleOrganizationUsers } from "@/lib/modules/platform/platform-organization-admin.service";

type Params = { params: Promise<{ companyId: string }> };

/** Existing accounts that may be added to this company (Admin Organization-Scoped PRD #7 §17). */
export async function GET(request: Request, { params }: Params) {
  return withPlatformContext(async (context) => {
    const { companyId } = await params;
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return apiOk({ data: await eligibleOrganizationUsers(context, companyId, q) });
  });
}
