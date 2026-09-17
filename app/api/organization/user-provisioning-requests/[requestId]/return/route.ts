import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reasonSchema } from "@/lib/modules/organization/provisioning/provisioning.schema";
import { returnProvisioningRequest } from "@/lib/modules/organization/provisioning/provisioning.service";

type Params = { params: Promise<{ requestId: string }> };

/** POST /api/organization/user-provisioning-requests/:requestId/return — back to HR with what needs to change; IT never corrects HR data itself (§29) (E-06 §92). */
export async function POST(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(async (context) => {
    const { reason } = reasonSchema.parse(await readJson(request));
    return apiOk({ data: await returnProvisioningRequest(context, requestId, reason) });
  });
}
