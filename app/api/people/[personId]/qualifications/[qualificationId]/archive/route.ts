import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { archiveQualificationSchema } from "@/lib/modules/hr/qualifications/qualification.schema";
import { archiveQualification } from "@/lib/modules/hr/qualifications/qualification.service";

type Params = { params: Promise<{ personId: string; qualificationId: string }> };

/** POST /api/people/:personId/qualifications/:qualificationId/archive — off the profile, with a reason; its history stays (E-02 §67). */
export async function POST(request: Request, { params }: Params) {
  const { personId, qualificationId } = await params;
  return withContext(async (context) => {
    const input = archiveQualificationSchema.parse(await readJson(request));
    return apiOk({ data: await archiveQualification(context, personId, qualificationId, input) });
  });
}
