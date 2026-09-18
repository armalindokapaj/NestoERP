import { apiOk, withContext } from "@/lib/api/respond";
import { getImportBatch } from "@/lib/modules/workforce/workforce.import";

type Params = { params: Promise<{ batchId: string }> };

/** GET /api/hr/employees/import/:batchId — a checked file, row by row (E-04 §96). */
export async function GET(_request: Request, { params }: Params) {
  const { batchId } = await params;
  return withContext(async (context) => apiOk({ data: await getImportBatch(context, batchId) }));
}
