import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createEngineeringDocument, listEngineeringDocuments } from "@/lib/modules/engineering/engineering.documents";
import { createEngineeringDocumentSchema, engineeringDocumentListSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's document and drawing register (PRD #46 §76-§78, §217). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const query = engineeringDocumentListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listEngineeringDocuments(context, { ...query, projectId }) });
  });
}

/** POST — register an engineering document (PRD #46 §60-§65, §217). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createEngineeringDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await createEngineeringDocument(context, projectId, input) }, { status: 201 });
  });
}
