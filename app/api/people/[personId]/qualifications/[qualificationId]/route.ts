import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateQualificationSchema } from "@/lib/modules/hr/qualifications/qualification.schema";
import { getQualification, updateQualification } from "@/lib/modules/hr/qualifications/qualification.service";

type Params = { params: Promise<{ personId: string; qualificationId: string }> };

/**
 * GET   /api/people/:personId/qualifications/:qualificationId — one qualification, in full, if this reader may.
 * PATCH /api/people/:personId/qualifications/:qualificationId — correct it; never its status (E-02 §31).
 */
export async function GET(_request: Request, { params }: Params) {
  const { personId, qualificationId } = await params;
  return withContext(async (context) => apiOk({ data: await getQualification(context, personId, qualificationId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { personId, qualificationId } = await params;
  return withContext(async (context) => {
    const input = updateQualificationSchema.parse(await readJson(request));
    return apiOk({ data: await updateQualification(context, personId, qualificationId, input) });
  });
}
