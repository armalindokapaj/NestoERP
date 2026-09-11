import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/commitments/commitment.service";

type Params = { params: Promise<{ commitmentId: string }> };

/** Archives a settled commitment (PRD #15 §136). */
export async function POST(_request: Request, { params }: Params) {
  const { commitmentId } = await params;
  return withContext(async (context) => {
    await service.archiveCommitment(context, commitmentId);
    return new Response(null, { status: 204 });
  });
}
