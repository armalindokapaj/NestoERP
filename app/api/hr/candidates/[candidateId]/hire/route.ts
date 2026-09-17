import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { hireCandidateSchema } from "@/lib/modules/hr/recruitment/candidate.schema";
import { hireCandidate } from "@/lib/modules/hr/recruitment/candidate.service";

type Params = { params: Promise<{ candidateId: string }> };

/**
 * POST /api/hr/candidates/:candidateId/hire — the selected candidate's
 * employment in the target company, with no login yet (E-06 §24, §25, §91).
 */
export async function POST(request: Request, { params }: Params) {
  const { candidateId } = await params;
  return withContext(async (context) => {
    const input = hireCandidateSchema.parse(await readJson(request));
    return apiOk({ data: await hireCandidate(context, candidateId, input) });
  });
}
