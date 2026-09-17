import { apiOk, withContext } from "@/lib/api/respond";
import { submitProvisioningRequest } from "@/lib/modules/organization/provisioning/provisioning.service";

type Params = { params: Promise<{ requestId: string }> };

/** POST /api/hr/user-provisioning-requests/:requestId/submit — a draft goes for approval (E-06 §28). */
export async function POST(_request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => apiOk({ data: await submitProvisioningRequest(context, requestId) }));
}
