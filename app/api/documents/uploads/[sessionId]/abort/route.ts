import { withContext } from "@/lib/api/respond";
import { abortUpload } from "@/lib/modules/documents/storage/upload.service";

type Params = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/documents/uploads/:sessionId/abort (PRD #29 §207, §208).
 *
 * Cancelling is a real action, not just a closed tab: the partial object is
 * removed, the quota reservation released and the placeholder document
 * deleted. 204, because there is nothing left to describe (PRD #29 §348).
 */
export async function POST(_request: Request, { params }: Params) {
  const { sessionId } = await params;

  return withContext(async (context) => {
    await abortUpload(context, sessionId);
    return new Response(null, { status: 204 });
  });
}
