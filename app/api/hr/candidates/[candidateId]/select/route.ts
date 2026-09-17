import { apiOk, withContext } from "@/lib/api/respond";
import { selectCandidate } from "@/lib/modules/hr/recruitment/candidate.service";

type Params = { params: Promise<{ candidateId: string }> };

/** POST /api/hr/candidates/:candidateId/select — the candidate wins the position (§24) (E-06 §91). */
export async function POST(_request: Request, { params }: Params) {
  const { candidateId } = await params;
  return withContext(async (context) => apiOk({ data: await selectCandidate(context, candidateId) }));
}
