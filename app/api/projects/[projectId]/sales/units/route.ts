import { apiOk, withContext } from "@/lib/api/respond";
import { listSalesInventory } from "@/lib/modules/sales/units/unit-sales.inventory";
import { parseInventoryQuery } from "@/lib/modules/sales/units/unit-sales.schema";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's units as Sales sees them: filtered, searched and sorted in the database, 50 a page (E-05E §13, §14, §45). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await listSalesInventory(context, projectId, parseInventoryQuery(new URL(request.url).searchParams)) }));
}
