import { apiOk, withContext } from "@/lib/api/respond";
import { removeIncidentPerson } from "@/lib/modules/hse/hse.workforce";

type Params = { params: Promise<{ incidentId: string; personRowId: string }> };

/** DELETE /api/hse/incidents/:incidentId/people/:personRowId — recorded in error (E-04 §73). */
export async function DELETE(_request: Request, { params }: Params) {
  const { incidentId, personRowId } = await params;
  return withContext(async (context) => {
    await removeIncidentPerson(context, incidentId, personRowId);
    return apiOk({ data: { removed: true } });
  });
}
