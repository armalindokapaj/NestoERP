import { withContext } from "@/lib/api/respond";
import { decisionSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { readJson } from "@/lib/api/respond";
import * as service from "@/lib/modules/finance/commitments/commitment.service";

type Params = { params: Promise<{ commitmentId: string }> };

/** Approves a commitment, adding it to forecast (PRD #15 §133). */
export async function POST(request: Request, { params }: Params) {
  const { commitmentId } = await params;
  return withContext(async (context) => {
    const input = decisionSchema.parse(await readJson(request).catch(() => ({})));
    await service.approveCommitment(context, commitmentId, input.note ?? null);
    return new Response(null, { status: 204 });
  });
}
