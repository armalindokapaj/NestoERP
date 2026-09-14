import { apiOk, withContext } from "@/lib/api/respond";
import { listEngineeringDocuments } from "@/lib/modules/engineering/engineering.documents";
import { engineeringDocumentListSchema } from "@/lib/modules/engineering/engineering.schema";

/** GET — engineering documents across the reader's projects (PRD #46 §217). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const query = engineeringDocumentListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listEngineeringDocuments(context, query) });
  });
}
