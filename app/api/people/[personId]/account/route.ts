import { apiOk, withContext } from "@/lib/api/respond";
import { getAccessSummary } from "@/lib/modules/people/people.service";

type Params = { params: Promise<{ personId: string }> };

/** GET /api/people/:personId/account — the person's NESTO access, for access administrators only (E-08 §29, §66). */
export async function GET(_request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await getAccessSummary(context, personId) }));
}
