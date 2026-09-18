import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { rejectQualificationSchema } from "@/lib/modules/hr/qualifications/qualification.schema";
import { rejectQualification } from "@/lib/modules/hr/qualifications/qualification.service";

type Params = { params: Promise<{ personId: string; qualificationId: string }> };

/** POST /api/people/:personId/qualifications/:qualificationId/reject — not accepted, with the reason the person will read (E-02 §77). */
export async function POST(request: Request, { params }: Params) {
  const { personId, qualificationId } = await params;
  return withContext(async (context) => {
    const input = rejectQualificationSchema.parse(await readJson(request));
    return apiOk({ data: await rejectQualification(context, personId, qualificationId, input) });
  });
}
