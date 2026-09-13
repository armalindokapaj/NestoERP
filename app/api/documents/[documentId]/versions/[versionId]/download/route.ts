import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createVersionDownloadGrant } from "@/lib/modules/documents/versions/version.service";

type Params = { params: Promise<{ documentId: string; versionId: string }> };

/** POST — a short-lived grant for one historical version, after full re-authorisation (PRD #38 §58, §150). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    if (!checkRateLimit("DOWNLOAD_GRANT", context.membershipId).allowed) {
      return apiError("VALIDATION_ERROR", "Too many downloads. Try again shortly.");
    }
    const { documentId, versionId } = await params;
    return apiOk({ data: await createVersionDownloadGrant(context, documentId, versionId) });
  });
}
