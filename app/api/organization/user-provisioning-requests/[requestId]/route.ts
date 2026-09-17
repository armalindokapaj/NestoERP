import { apiOk, withContext } from "@/lib/api/respond";
import { getProvisioningRequest } from "@/lib/modules/organization/provisioning/provisioning.service";

type Params = { params: Promise<{ requestId: string }> };

/** GET /api/organization/user-provisioning-requests/:requestId — the HR truth IT works from (E-06 §29, §64). */
export async function GET(_request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => apiOk({ data: await getProvisioningRequest(context, requestId) }));
}
