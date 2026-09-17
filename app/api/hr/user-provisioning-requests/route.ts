import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createProvisioningRequestSchema } from "@/lib/modules/organization/provisioning/provisioning.schema";
import { createProvisioningRequest } from "@/lib/modules/organization/provisioning/provisioning.service";

/**
 * POST /api/hr/user-provisioning-requests — HR asks for a NESTO account for an
 * employee, from the employment it recorded (E-06 §27, §28, §92). HR never
 * creates the credentials (§140).
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createProvisioningRequestSchema.parse(await readJson(request));
    return apiOk({ data: await createProvisioningRequest(context, input) }, { status: 201 });
  });
}
