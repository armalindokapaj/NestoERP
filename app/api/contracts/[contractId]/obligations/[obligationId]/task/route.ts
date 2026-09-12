import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { obligationTaskSchema } from "@/lib/modules/contracts/obligations/obligation.schema";
import * as obligations from "@/lib/modules/contracts/obligations/obligation.service";

type Params = { params: Promise<{ obligationId: string }> };

/**
 * Raises the work that satisfies an obligation (PRD #18 §154, §431).
 *
 * It is a canonical Task: the same record appears in /tasks and on the
 * obligation, because there is only one of it.
 */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { obligationId } = await params;
    const input = obligationTaskSchema.parse(await readJson(request));
    return apiOk(
      { data: await obligations.createTaskForObligation(context, obligationId, input) },
      { status: 201 },
    );
  });
}
