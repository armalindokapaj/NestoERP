import { apiOk, withContext } from "@/lib/api/respond";
import { approveProvisioningRequest } from "@/lib/modules/organization/provisioning/provisioning.service";

type Params = { params: Promise<{ requestId: string }> };

/** POST /api/organization/user-provisioning-requests/:requestId/approve — the Head of Group HR or the Owner decides the person gets an account; never the requester (E-06 §92). */
export async function POST(_request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => apiOk({ data: await approveProvisioningRequest(context, requestId) }));
}
