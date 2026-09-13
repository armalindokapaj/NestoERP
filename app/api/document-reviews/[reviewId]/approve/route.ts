import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { decideReview, decideReviewSchema } from "@/lib/modules/documents/versions/review.service";

type Params = { params: Promise<{ reviewId: string }> };

/** POST /api/document-reviews/:reviewId/approve — only the assigned reviewer decides (PRD #38 §62, §68). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { reviewId } = await params;
    const body = await readJson(request).catch(() => ({}));
    const { note } = decideReviewSchema.parse(body);
    return apiOk({ data: await decideReview(context, reviewId, "APPROVED", note) });
  });
}
