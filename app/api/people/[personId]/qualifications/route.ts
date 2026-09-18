import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createQualificationSchema } from "@/lib/modules/hr/qualifications/qualification.schema";
import { createQualification } from "@/lib/modules/hr/qualifications/qualification.service";
import { getQualificationsTab } from "@/lib/modules/people/people.service";

type Params = { params: Promise<{ personId: string }> };

/**
 * GET  /api/people/:personId/qualifications — what this reader may see: the full records (the
 *      person, HR) or the verified summaries the person shares with the group (E-02 §100-§105, §118).
 * POST /api/people/:personId/qualifications — add one: the person their own, HR somebody it employs;
 *      with `renewsId`, a renewal (§69, §91).
 */
export async function GET(_request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await getQualificationsTab(context, personId) }));
}

export async function POST(request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => {
    const input = createQualificationSchema.parse(await readJson(request));
    return apiOk({ data: await createQualification(context, personId, input) }, { status: 201 });
  });
}
