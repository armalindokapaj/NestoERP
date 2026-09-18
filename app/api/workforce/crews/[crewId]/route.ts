import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { getCrew, updateCrew } from "@/lib/modules/workforce/crew.service";
import { updateCrewSchema } from "@/lib/modules/workforce/workforce.schema";

type Params = { params: Promise<{ crewId: string }> };

/**
 * GET   /api/workforce/crews/:crewId — the crew, its members and its history (E-04 §29, §30).
 * PATCH /api/workforce/crews/:crewId — rename, move, change the supervisor, archive.
 *
 * A crew out of the reader's view answers 404, never 403.
 */
export async function GET(_request: Request, { params }: Params) {
  const { crewId } = await params;
  return withContext(async (context) => apiOk({ data: await getCrew(context, crewId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { crewId } = await params;
  return withContext(async (context) => {
    const input = updateCrewSchema.parse(await readJson(request));
    return apiOk({ data: await updateCrew(context, crewId, input) });
  });
}
