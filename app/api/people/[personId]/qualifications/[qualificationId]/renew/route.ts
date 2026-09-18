import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createQualificationSchema } from "@/lib/modules/hr/qualifications/qualification.schema";
import { createQualification } from "@/lib/modules/hr/qualifications/qualification.service";

type Params = { params: Promise<{ personId: string; qualificationId: string }> };

/**
 * POST /api/people/:personId/qualifications/:qualificationId/renew — the renewed qualification: a
 * new current record, checked afresh; this one is superseded and kept (E-02 §91, §194).
 */
export async function POST(request: Request, { params }: Params) {
  const { personId, qualificationId } = await params;
  return withContext(async (context) => {
    const input = createQualificationSchema.parse({ ...((await readJson(request)) as Record<string, unknown>), renewsId: qualificationId });
    return apiOk({ data: await createQualification(context, personId, input) }, { status: 201 });
  });
}
