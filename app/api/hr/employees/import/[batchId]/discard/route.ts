import { apiOk, withContext } from "@/lib/api/respond";
import { discardImport } from "@/lib/modules/workforce/workforce.import";

type Params = { params: Promise<{ batchId: string }> };

/** POST /api/hr/employees/import/:batchId/discard — set a checked file aside without importing it. */
export async function POST(_request: Request, { params }: Params) {
  const { batchId } = await params;
  return withContext(async (context) => {
    await discardImport(context, batchId);
    return apiOk({ data: { discarded: true } });
  });
}
