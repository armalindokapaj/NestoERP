import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { managedWorkProfileSchema } from "@/lib/modules/people/people.schema";
import { updateManagedWorkProfile } from "@/lib/modules/people/people.service";

type Params = { params: Promise<{ personId: string }> };

/** PATCH /api/people/:personId/work-profile — those who keep person records correct a work profile (E-01 §116, §125). */
export async function PATCH(request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => {
    const input = managedWorkProfileSchema.parse(await readJson(request));
    return apiOk({ data: await updateManagedWorkProfile(context, personId, input) });
  });
}
