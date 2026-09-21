import { apiOk, withContext } from "@/lib/api/respond";
import { getWorkProfile } from "@/lib/modules/people/people.service";

type Params = { params: Promise<{ personId: string }> };

/** GET /api/people/:personId — the work profile any colleague in the group reads; nothing HR keeps private (E-01 §119, §122). */
export async function GET(_request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await getWorkProfile(context, personId) }), { group: "read" });
}
