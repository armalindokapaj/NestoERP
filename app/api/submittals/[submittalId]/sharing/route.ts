import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { setSharingClassification } from "@/lib/modules/engineering/engineering.revisions";
import { sharingSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ submittalId: string }> };

/** POST — record a file's future sharing classification (PRD #46 §128-§132). */
export async function POST(request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = sharingSchema.parse(await readJson(request));
    await setSharingClassification(context, "submittal", submittalId, input.documentId, input.classification);
    return apiOk({ data: { updated: true } });
  });
}
