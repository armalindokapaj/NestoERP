import { assertPermission } from "@/lib/access/guards";
import { apiOk, withContext } from "@/lib/api/respond";
import { duplicateCheckSchema } from "@/lib/modules/contractors/contractor.schema";
import { findDuplicateContractors } from "@/lib/modules/contractors/contractor.service";

/** GET — contractors that look like the one being entered — a warning, never a merge (PRD #46 §16). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    assertPermission(context, "contractor.create");
    const query = duplicateCheckSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await findDuplicateContractors(context, query) });
  });
}
