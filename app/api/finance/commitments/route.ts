import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { parseCommitmentQuery } from "@/lib/modules/finance/finance.query";
import { createCommitmentSchema } from "@/lib/modules/finance/commitments/commitment.schema";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";

/** GET/POST /api/finance/commitments (PRD #15 §225). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(
      await commitments.listCommitments(context, parseCommitmentQuery(url.searchParams)),
    );
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createCommitmentSchema.parse(await readJson(request));
    return apiOk({ data: await commitments.createCommitment(context, input) }, { status: 201 });
  });
}
