import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { resubmitQualificationSchema } from "@/lib/modules/hr/qualifications/qualification.schema";
import { resubmitQualification } from "@/lib/modules/hr/qualifications/qualification.service";

type Params = { params: Promise<{ personId: string; qualificationId: string }> };

/** POST /api/people/:personId/qualifications/:qualificationId/resubmit — a rejected qualification back to the verifier, with a new file if there is one (E-02 §79). */
export async function POST(request: Request, { params }: Params) {
  const { personId, qualificationId } = await params;
  return withContext(async (context) => {
    const input = resubmitQualificationSchema.parse(await readJson(request));
    return apiOk({ data: await resubmitQualification(context, personId, qualificationId, input) });
  });
}
