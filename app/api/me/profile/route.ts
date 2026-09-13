import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateProfileSchema } from "@/lib/modules/account/account.schema";
import * as account from "@/lib/modules/account/account.service";

/** The signed-in person's own profile (PRD #38 §20). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await account.getProfile(context) }));
}

export async function PATCH(request: Request) {
  return withContext(async (context) => {
    const input = updateProfileSchema.parse(await readJson(request));
    return apiOk({ data: await account.updateProfile(context, input) });
  });
}
