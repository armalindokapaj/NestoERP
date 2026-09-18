import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { ownWorkProfileSchema } from "@/lib/modules/people/people.schema";
import { updateOwnWorkProfile } from "@/lib/modules/people/people.service";

/** PATCH /api/people/me/work-profile — your bio, extension, office and preferred name (E-01 §53, §124). */
export async function PATCH(request: Request) {
  return withContext(async (context) => {
    const input = ownWorkProfileSchema.parse(await readJson(request));
    return apiOk({ data: await updateOwnWorkProfile(context, input) });
  });
}
