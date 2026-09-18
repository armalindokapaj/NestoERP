import { apiOk, withContext } from "@/lib/api/respond";
import { getPrivateProfile } from "@/lib/modules/people/people.service";

type Params = { params: Promise<{ personId: string }> };

/** GET /api/people/:personId/private — personal contact and address, for the person and those who keep person records (E-01 §34, §100, §120). */
export async function GET(_request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await getPrivateProfile(context, personId) }));
}
