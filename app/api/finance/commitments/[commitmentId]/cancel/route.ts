import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/commitments/commitment.service";

type Params = { params: Promise<{ commitmentId: string }> };

/** Cancels a commitment (PRD #15 §135). */
export async function POST(_request: Request, { params }: Params) {
  const { commitmentId } = await params;
  return withContext(async (context) => {
    await service.cancelCommitment(context, commitmentId);
    return new Response(null, { status: 204 });
  });
}
