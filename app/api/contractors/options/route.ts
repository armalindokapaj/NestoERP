import { apiOk, withContext } from "@/lib/api/respond";
import { contractorFormOptions } from "@/lib/modules/contractors/contractor.service";

/** GET — what the contractor form may offer this writer (PRD #46 §15). */
export async function GET() {
  return withContext(async (context) => {
    return apiOk({ data: await contractorFormOptions(context) });
  });
}
