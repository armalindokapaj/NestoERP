import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reassignReview, reassignReviewSchema } from "@/lib/modules/documents/versions/review.service";

type Params = { params: Promise<{ reviewId: string }> };

/** POST /api/document-reviews/:reviewId/reassign — hand a pending review to someone else, audited (PRD #41 §236, §237). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { reviewId } = await params;
    const input = reassignReviewSchema.parse(await readJson(request));
    return apiOk({ data: await reassignReview(context, reviewId, input) });
  });
}
