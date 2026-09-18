import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { incidentPersonSchema } from "@/lib/modules/hse/hse.schema";
import { addIncidentPerson, listIncidentPeople } from "@/lib/modules/hse/hse.workforce";

type Params = { params: Promise<{ incidentId: string }> };

/**
 * GET  /api/hse/incidents/:incidentId/people — who the incident involved (E-04 §73).
 * POST /api/hse/incidents/:incidentId/people — an employee, with or without a login, or a name.
 *
 * Readers of the incident only; an incident out of view answers 404.
 */
export async function GET(_request: Request, { params }: Params) {
  const { incidentId } = await params;
  return withContext(async (context) => apiOk({ data: await listIncidentPeople(context, incidentId) }));
}

export async function POST(request: Request, { params }: Params) {
  const { incidentId } = await params;
  return withContext(async (context) => {
    await addIncidentPerson(context, incidentId, incidentPersonSchema.parse(await readJson(request)));
    return apiOk({ data: await listIncidentPeople(context, incidentId) }, { status: 201 });
  });
}
