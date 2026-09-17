import { apiOk, withContext } from "@/lib/api/respond";
import { rejectCandidate } from "@/lib/modules/hr/recruitment/candidate.service";

type Params = { params: Promise<{ candidateId: string }> };

/** POST /api/hr/candidates/:candidateId/reject — HR decides against the candidate (E-06 §91). */
export async function POST(_request: Request, { params }: Params) {
  const { candidateId } = await params;
  return withContext(async (context) => apiOk({ data: await rejectCandidate(context, candidateId) }));
}
