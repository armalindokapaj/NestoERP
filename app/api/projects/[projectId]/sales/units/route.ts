import { apiOk, withContext } from "@/lib/api/respond";
import { listSalesInventory, listSalesSelection } from "@/lib/modules/sales/units/unit-sales.inventory";
import { parseInventoryQuery } from "@/lib/modules/sales/units/unit-sales.schema";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET — the project's units as Sales sees them: filtered, searched and sorted
 * in the database, 50 a page (E-05E §13, §14, §45). With `select=all`, every
 * unit the same filters match instead of a page — their ids and versions, at
 * most 500 — for "Select all N matching" (2026-11-09).
 */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const search = new URL(request.url).searchParams;
  return withContext(async (context) => {
    const query = parseInventoryQuery(search);
    return apiOk({ data: search.get("select") === "all" ? await listSalesSelection(context, projectId, query) : await listSalesInventory(context, projectId, query) });
  });
}
