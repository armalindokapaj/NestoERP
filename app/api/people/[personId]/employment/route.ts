import { apiOk, withContext } from "@/lib/api/respond";
import { getEmploymentView } from "@/lib/modules/people/people.service";

type Params = { params: Promise<{ personId: string }> };

/** GET /api/people/:personId/employment — HR's records of the person, as HR lets the reader see them (E-01 §98, §120, §129). */
export async function GET(_request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await getEmploymentView(context, personId) }));
}
