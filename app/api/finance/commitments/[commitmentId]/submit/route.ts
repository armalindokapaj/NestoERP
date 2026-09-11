import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/commitments/commitment.service";

type Params = { params: Promise<{ commitmentId: string }> };

/** Submits a draft or rejected commitment for approval (PRD #15 §132). */
export async function POST(_request: Request, { params }: Params) {
  const { commitmentId } = await params;
  return withContext(async (context) => {
    await service.submitCommitment(context, commitmentId);
    return new Response(null, { status: 204 });
  });
}
