import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/commitments/commitment.service";

type Params = { params: Promise<{ commitmentId: string }> };

/** Closes a commitment so it stops counting toward forecast (PRD #15 §134). */
export async function POST(_request: Request, { params }: Params) {
  const { commitmentId } = await params;
  return withContext(async (context) => {
    await service.closeCommitment(context, commitmentId);
    return new Response(null, { status: 204 });
  });
}
