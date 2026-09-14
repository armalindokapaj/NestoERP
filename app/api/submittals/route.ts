import { apiOk, withContext } from "@/lib/api/respond";
import { submittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { listSubmittals } from "@/lib/modules/engineering/engineering.submittals";

/** GET — submittals across the reader's projects (PRD #46 §220). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const query = submittalListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listSubmittals(context, query) });
  });
}
