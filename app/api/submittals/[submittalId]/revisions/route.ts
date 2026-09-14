import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createRevision } from "@/lib/modules/engineering/engineering.revisions";
import { createRevisionSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ submittalId: string }> };

/** POST — add a revision from a file uploaded to the submittal, optionally submitting it (PRD #46 §102, §220). */
export async function POST(request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createRevisionSchema.parse(await readJson(request));
    return apiOk({ data: await createRevision(context, "submittal", submittalId, input) }, { status: 201 });
  });
}
