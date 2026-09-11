import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateCommitmentSchema } from "@/lib/modules/finance/commitments/commitment.schema";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";

type Params = { params: Promise<{ commitmentId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { commitmentId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await commitments.getCommitment(context, commitmentId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { commitmentId } = await params;
  return withContext(async (context) => {
    const input = updateCommitmentSchema.parse(await readJson(request));
    return apiOk({ data: await commitments.updateCommitment(context, commitmentId, input) });
  });
}
