import { apiOk, withContext } from "@/lib/api/respond";
import { listEligibleReviewers } from "@/lib/modules/documents/versions/review.service";

type Params = { params: Promise<{ documentId: string }> };

/** People who could review this document right now (PRD #38 §62). */
export async function GET(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { documentId } = await params;
    const q = new URL(request.url).searchParams.get("q") ?? undefined;
    return apiOk({ data: await listEligibleReviewers(context, documentId, q) });
  });
}
