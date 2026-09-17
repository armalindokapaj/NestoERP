import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { candidateListQuerySchema, createCandidateSchema } from "@/lib/modules/hr/recruitment/candidate.schema";
import { createCandidate, listCandidates } from "@/lib/modules/hr/recruitment/candidate.service";

/**
 * GET  /api/hr/candidates — the candidates HR recruits, in the reader's reach (E-06 §91).
 * POST /api/hr/candidates — a new person and their candidacy, before any login exists (§22, §23).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await listCandidates(context, candidateListQuerySchema.parse(Object.fromEntries(url.searchParams))));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createCandidateSchema.parse(await readJson(request));
    return apiOk({ data: await createCandidate(context, input) }, { status: 201 });
  });
}
