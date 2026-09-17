import { apiOk, withContext } from "@/lib/api/respond";
import { listFinanceInventory } from "@/lib/modules/finance/units/unit-finance.inventory";
import { parseFinanceInventoryQuery } from "@/lib/modules/finance/units/unit-finance.schema";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's units as Finance sees them: filtered, counted and totalled in the database, 50 a page (E-05F §45-§48, §65). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await listFinanceInventory(context, projectId, parseFinanceInventoryQuery(new URL(request.url).searchParams)) }));
}
