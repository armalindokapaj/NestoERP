import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { provisionSchema } from "@/lib/modules/organization/provisioning/provisioning.schema";
import { provisionAccount } from "@/lib/modules/organization/provisioning/provisioning.service";

type Params = { params: Promise<{ requestId: string }> };

/**
 * POST /api/organization/user-provisioning-requests/:requestId/provision —
 * Create User from HR Profile (E-06 §57, §93): the user, membership, department
 * assignment and employment link in one transaction. The temporary password is
 * in this response and nowhere else.
 */
export async function POST(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => {
    const input = provisionSchema.parse(await readJson(request));
    return apiOk({ data: await provisionAccount(context, requestId, input) });
  });
}
