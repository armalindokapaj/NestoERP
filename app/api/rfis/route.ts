import { apiOk, withContext } from "@/lib/api/respond";
import { listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { rfiListSchema } from "@/lib/modules/engineering/engineering.schema";

/** GET — RFIs across the reader's projects (PRD #46 §219). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const query = rfiListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listRfis(context, query) });
  });
}
