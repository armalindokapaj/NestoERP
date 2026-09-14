import { apiOk, withContext } from "@/lib/api/respond";
import { myEngineeringWork } from "@/lib/modules/engineering/engineering.overview";

/** GET — RFIs waiting on me, reviews assigned to me, and RFIs to close (PRD #46 §278). */
export async function GET() {
  return withContext(async (context) => {
    return apiOk({ data: await myEngineeringWork(context) });
  });
}
