import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createRevision } from "@/lib/modules/engineering/engineering.revisions";
import { createRevisionSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ documentId: string }> };

/** POST — add a revision from a file uploaded to the document, optionally submitting it (PRD #46 §218). */
export async function POST(request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createRevisionSchema.parse(await readJson(request));
    return apiOk({ data: await createRevision(context, "document", documentId, input) }, { status: 201 });
  });
}
