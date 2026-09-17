import { apiOk, withContext } from "@/lib/api/respond";
import { startProvisioningRequest } from "@/lib/modules/organization/provisioning/provisioning.service";

type Params = { params: Promise<{ requestId: string }> };

/** POST /api/organization/user-provisioning-requests/:requestId/start — Group IT takes the request on (E-06 §92). */
export async function POST(_request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => apiOk({ data: await startProvisioningRequest(context, requestId) }));
}
