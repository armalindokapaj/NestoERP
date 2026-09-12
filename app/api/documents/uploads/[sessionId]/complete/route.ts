import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { completeDocumentUploadSchema } from "@/lib/modules/documents/storage/storage.schema";
import { completeUpload } from "@/lib/modules/documents/storage/upload.service";

type Params = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/documents/uploads/:sessionId/complete (PRD #29 §79, §205).
 *
 * The browser says it finished; the server checks. The object is HEADed for
 * its real size, its leading bytes are read to see what it really is, and its
 * checksum is verified. Only then does the document become available
 * (PRD #29 §80, §233).
 *
 * Repeating the call returns the document's current state rather than
 * processing it twice (PRD #29 §81, §263).
 */
export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;

  return withContext(async (context) => {
    const body = await readJson(request).catch(() => ({}));
    const input = completeDocumentUploadSchema.parse(body);
    return apiOk(await completeUpload(context, sessionId, input));
  });
}
