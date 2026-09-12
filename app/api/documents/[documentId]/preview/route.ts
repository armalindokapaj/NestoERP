import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createPreviewGrant } from "@/lib/modules/documents/storage/preview.service";

type Params = { params: Promise<{ documentId: string }> };

/**
 * POST /api/documents/:documentId/preview (PRD #29 §104, §205).
 *
 * A separate endpoint from download because it is a different decision, not a
 * different parameter: a download hands over bytes, a preview asks a browser
 * to *render* them. Only PDF, JPEG, PNG and WEBP get one — the formats that
 * cannot execute (PRD #29 §44, §53, §240).
 *
 * The authorisation is identical to a download's (§105).
 */
export async function POST(_request: Request, { params }: Params) {
  const { documentId } = await params;

  return withContext(async (context) => {
    const limit = checkRateLimit("DOWNLOAD_GRANT", context.membershipId);
    if (!limit.allowed) {
      return apiError("VALIDATION_ERROR", "Too many preview requests. Try again shortly.");
    }

    return apiOk(await createPreviewGrant(context, documentId));
  });
}
