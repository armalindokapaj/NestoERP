import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { requestReview, requestReviewSchema } from "@/lib/modules/documents/versions/review.service";

type Params = { params: Promise<{ versionId: string }> };

/** POST /api/document-versions/:versionId/reviews — send a version for review (PRD #38 §68). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { versionId } = await params;
    const input = requestReviewSchema.parse(await readJson(request));
    return apiOk({ data: await requestReview(context, versionId, input) }, { status: 201 });
  });
}
