import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { addRfiReference, rfiReferenceOptions } from "@/lib/modules/engineering/engineering.rfis";
import { rfiReferenceSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ rfiId: string }> };

/** GET — records of one kind on the project this writer could reference (PRD #46 §91, §92). */
export async function GET(request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    const type = rfiReferenceSchema.shape.referenceType.parse(new URL(request.url).searchParams.get("type"));
    return apiOk({ data: await rfiReferenceOptions(context, rfiId, type) });
  });
}

/** POST — reference a drawing, document, submittal, meeting, log, task or contract on the same project (PRD #46 §91, §305). */
export async function POST(request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = rfiReferenceSchema.parse(await readJson(request));
    return apiOk({ data: await addRfiReference(context, rfiId, input) }, { status: 201 });
  });
}
