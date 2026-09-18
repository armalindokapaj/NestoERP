import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { verifyQualificationSchema } from "@/lib/modules/hr/qualifications/qualification.schema";
import { verifyQualification } from "@/lib/modules/hr/qualifications/qualification.service";

type Params = { params: Promise<{ personId: string; qualificationId: string }> };

/** POST /api/people/:personId/qualifications/:qualificationId/verify — checked and accepted by a verifier who is not the person (E-02 §72-§76). */
export async function POST(request: Request, { params }: Params) {
  const { personId, qualificationId } = await params;
  return withContext(async (context) => {
    const input = verifyQualificationSchema.parse(await readJson(request));
    return apiOk({ data: await verifyQualification(context, personId, qualificationId, input) });
  });
}
