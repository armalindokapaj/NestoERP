import { apiOk, withContext } from "@/lib/api/respond";
import { commitImport } from "@/lib/modules/workforce/workforce.import";

type Params = { params: Promise<{ batchId: string }> };

/**
 * POST /api/hr/employees/import/:batchId/commit — make every row that is still
 * good, each on its own; the answer lists the rows that were not (E-04 §97, §163).
 */
export async function POST(_request: Request, { params }: Params) {
  const { batchId } = await params;
  return withContext(async (context) => apiOk({ data: await commitImport(context, batchId) }));
}
