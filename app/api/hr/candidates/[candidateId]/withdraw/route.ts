import { apiOk, withContext } from "@/lib/api/respond";
import { withdrawCandidate } from "@/lib/modules/hr/recruitment/candidate.service";

type Params = { params: Promise<{ candidateId: string }> };

/** POST /api/hr/candidates/:candidateId/withdraw — the candidate withdraws (E-06 §91). */
export async function POST(_request: Request, { params }: Params) {
  const { candidateId } = await params;
  return withContext(async (context) => apiOk({ data: await withdrawCandidate(context, candidateId) }));
}
