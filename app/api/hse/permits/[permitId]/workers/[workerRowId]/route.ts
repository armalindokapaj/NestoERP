import { apiOk, withContext } from "@/lib/api/respond";
import { removePermitWorker } from "@/lib/modules/hse/hse.workforce";

type Params = { params: Promise<{ permitId: string; workerRowId: string }> };

/** DELETE /api/hse/permits/:permitId/workers/:workerRowId — off a draft permit (E-04 §74). */
export async function DELETE(_request: Request, { params }: Params) {
  const { permitId, workerRowId } = await params;
  return withContext(async (context) => {
    await removePermitWorker(context, permitId, workerRowId);
    return apiOk({ data: { removed: true } });
  });
}
