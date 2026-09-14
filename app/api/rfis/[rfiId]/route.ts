import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { getRfi, updateRfi } from "@/lib/modules/engineering/engineering.rfis";
import { updateRfiSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ rfiId: string }> };

/** GET — one RFI with its responses, references and tasks (PRD #46 §219). */
export async function GET(_request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await getRfi(context, rfiId) });
  });
}

/** PATCH — edit assignment, due date and context; the question is fixed once open (PRD #46 §219, §252). */
export async function PATCH(request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateRfiSchema.parse(await readJson(request));
    return apiOk({ data: await updateRfi(context, rfiId, input) });
  });
}
