import { apiOk, withContext } from "@/lib/api/respond";
import { listVersions } from "@/lib/modules/documents/versions/version.service";

type Params = { params: Promise<{ documentId: string }> };

/** GET /api/documents/:documentId/versions — the version history, with reviews (PRD #38 §67). */
export async function GET(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { documentId } = await params;
    return apiOk({ data: await listVersions(context, documentId) });
  });
}
