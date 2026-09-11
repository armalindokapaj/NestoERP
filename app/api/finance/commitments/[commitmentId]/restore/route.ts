import { withContext } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/commitments/commitment.service";

type Params = { params: Promise<{ commitmentId: string }> };

/** Returns an archived commitment to the status it held (PRD #15 §136). */
export async function POST(_request: Request, { params }: Params) {
  const { commitmentId } = await params;
  return withContext(async (context) => {
    await service.restoreCommitment(context, commitmentId);
    return new Response(null, { status: 204 });
  });
}
