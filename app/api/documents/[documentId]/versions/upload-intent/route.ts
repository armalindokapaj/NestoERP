import { z } from "zod";

import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createVersionUploadSession } from "@/lib/modules/documents/storage/upload.service";

type Params = { params: Promise<{ documentId: string }> };

const schema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(160).optional(),
  sizeBytes: z.number().int().positive(),
  changeNote: z.string().trim().max(500).optional(),
});

/**
 * POST /api/documents/:documentId/versions/upload-intent (PRD #38 §67).
 *
 * Authorises a new binary for an existing document and returns a signed URL
 * for a new object key. The current version is not touched.
 */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    if (!checkRateLimit("UPLOAD", context.membershipId).allowed) {
      return apiError("VALIDATION_ERROR", "Too many uploads started. Try again shortly.");
    }
    const { documentId } = await params;
    const input = schema.parse(await readJson(request));
    const session = await createVersionUploadSession(context, documentId, input, {
      idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined,
    });
    return apiOk(session, { status: 201 });
  });
}
