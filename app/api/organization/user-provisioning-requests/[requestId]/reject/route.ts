import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reasonSchema } from "@/lib/modules/organization/provisioning/provisioning.schema";
import { rejectProvisioningRequest } from "@/lib/modules/organization/provisioning/provisioning.service";

type Params = { params: Promise<{ requestId: string }> };

/** POST /api/organization/user-provisioning-requests/:requestId/reject — the approver refuses the account, with a reason (E-06 §92). */
export async function POST(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => {
    const { reason } = reasonSchema.parse(await readJson(request));
    return apiOk({ data: await rejectProvisioningRequest(context, requestId, reason) });
  });
}
