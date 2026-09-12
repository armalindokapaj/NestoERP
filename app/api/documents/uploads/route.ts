import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createDocumentUploadSchema } from "@/lib/modules/documents/storage/storage.schema";
import { createUploadSession } from "@/lib/modules/documents/storage/upload.service";

/**
 * POST /api/documents/uploads — authorise one upload (PRD #29 §75, §205).
 *
 * Returns a short-lived signed URL for exactly one object key. Everything the
 * server needs to decide is checked here, before any bytes move: the caller,
 * the parent record, the declared type and size, and the company's remaining
 * quota (PRD #29 §11).
 *
 * `Idempotency-Key` is honoured, so a browser that retries the authorisation
 * after a dropped connection gets the session it already has rather than a
 * second one (PRD #29 §261, §262).
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    // Signed-URL generation is the thing worth protecting from abuse
    // (PRD #29 §260).
    const limit = checkRateLimit("UPLOAD", context.membershipId);
    if (!limit.allowed) {
      return apiError("VALIDATION_ERROR", "Too many uploads started. Try again shortly.");
    }

    const input = createDocumentUploadSchema.parse(await readJson(request));
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;

    const session = await createUploadSession(context, input, { idempotencyKey });
    return apiOk(session, { status: 201 });
  });
}
