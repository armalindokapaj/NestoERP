import { apiOk, withContext } from "@/lib/api/respond";
import { provisioningListQuerySchema } from "@/lib/modules/organization/provisioning/provisioning.schema";
import { listProvisioningRequests } from "@/lib/modules/organization/provisioning/provisioning.service";

/** GET /api/organization/user-provisioning-requests — account requests in the reader's reach (E-06 §92, §113). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await listProvisioningRequests(context, provisioningListQuerySchema.parse(Object.fromEntries(url.searchParams))));
  });
}
