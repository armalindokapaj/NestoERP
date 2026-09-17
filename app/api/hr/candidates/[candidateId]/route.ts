import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateCandidateSchema } from "@/lib/modules/hr/recruitment/candidate.schema";
import { getCandidate, updateCandidate } from "@/lib/modules/hr/recruitment/candidate.service";

type Params = { params: Promise<{ candidateId: string }> };

/** GET, PATCH /api/hr/candidates/:candidateId (E-06 §91). A candidate outside the reader's reach is not found. */
export async function GET(_request: Request, { params }: Params) {
  const { candidateId } = await params;
  return withContext(async (context) => apiOk({ data: await getCandidate(context, candidateId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { candidateId } = await params;
  return withContext(async (context) => {
    const input = updateCandidateSchema.parse(await readJson(request));
    return apiOk({ data: await updateCandidate(context, candidateId, input) });
  });
}
