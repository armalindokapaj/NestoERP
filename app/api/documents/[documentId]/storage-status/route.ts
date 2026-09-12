import { apiOk, withContext } from "@/lib/api/respond";
import { getStorageStatus } from "@/lib/modules/documents/storage/status.service";

type Params = { params: Promise<{ documentId: string }> };

/**
 * GET /api/documents/:documentId/storage-status (PRD #29 §209, §210).
 *
 * What the upload queue polls while a file is processing. It carries a safe
 * rejection code and a message, never a scanner's reasoning (PRD #29 §211).
 */
export async function GET(_request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) => apiOk(await getStorageStatus(context, documentId)));
}
