import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { getEngineeringDocument, updateEngineeringDocument } from "@/lib/modules/engineering/engineering.documents";
import { updateEngineeringDocumentSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ documentId: string }> };

/** GET — one document with its revision history, reviews and links (PRD #46 §79, §217). */
export async function GET(_request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await getEngineeringDocument(context, documentId) });
  });
}

/** PATCH — edit its register entry — never its revisions or status (PRD #46 §217, §252). */
export async function PATCH(request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateEngineeringDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await updateEngineeringDocument(context, documentId, input) });
  });
}
