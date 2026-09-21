import { AccessError } from "@/lib/access/guards";
import { apiOk, withContext } from "@/lib/api/respond";
import { getWorkProfile, myPersonId } from "@/lib/modules/people/people.service";

/** GET /api/people/me — your own work profile (E-01 §10, §115). */
export async function GET() {
  // The person's own profile: no company to get wrong (Workspace Context §14).
  return withContext(
    async (context) => {
      const personId = await myPersonId(context);
      if (!personId) throw new AccessError("NOT_FOUND");
      return apiOk({ data: await getWorkProfile(context, personId) });
    },
    { group: "any" },
  );
}
