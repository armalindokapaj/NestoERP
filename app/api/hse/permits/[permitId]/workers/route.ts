import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { permitWorkerSchema } from "@/lib/modules/hse/hse.schema";
import { addPermitWorker, listPermitWorkers } from "@/lib/modules/hse/hse.workforce";

type Params = { params: Promise<{ permitId: string }> };

/**
 * GET  /api/hse/permits/:permitId/workers — who the permit covers (E-04 §74).
 * POST /api/hse/permits/:permitId/workers — a person or a crew, while the permit is a draft.
 */
export async function GET(_request: Request, { params }: Params) {
  const { permitId } = await params;
  return withContext(async (context) => apiOk({ data: await listPermitWorkers(context, permitId) }));
}

export async function POST(request: Request, { params }: Params) {
  const { permitId } = await params;
  return withContext(async (context) => {
    await addPermitWorker(context, permitId, permitWorkerSchema.parse(await readJson(request)));
    return apiOk({ data: await listPermitWorkers(context, permitId) }, { status: 201 });
  });
}
