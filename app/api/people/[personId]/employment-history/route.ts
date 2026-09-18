import { apiOk, withContext } from "@/lib/api/respond";
import { getPersonEmploymentHistory } from "@/lib/modules/hr/employment/employment.query";

type Params = { params: Promise<{ personId: string }> };

/**
 * GET /api/people/:personId/employment-history — a person's employment and
 * organization history across the group's companies, each employment as far as
 * HR lets this reader see it: HR's view in scope, or the person's own (E-03 §4,
 * §57, §58). A colleague is refused: the work profile is current only (§56).
 */
export async function GET(_request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await getPersonEmploymentHistory(context, personId) }));
}
