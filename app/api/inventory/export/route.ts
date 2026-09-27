import { withContext } from "@/lib/api/respond";
import { exportResponse, recordExport } from "@/lib/core/export/exporter";
import { exportSelector } from "@/lib/core/export/export-params";
import { exportInventory, INVENTORY_EXPORT_TYPES, parseInventoryExport } from "@/lib/modules/inventory/inventory.export";

/**
 * CSV export (PRD #20 §214, §215; AUD-08 §7).
 *
 * The same query, the same services and the same scope as the screen — so the
 * file can never contain a row or a column the reader could not see, and holds
 * every row the list matches. Only the requested type's filters are read, with
 * that list's own vocabulary; an unknown type or filter is refused rather than
 * dropped. The `inventory.export` grant is checked on top of the view
 * permission for whatever is being exported (PRD #20 §215).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const type = exportSelector(params, "type", INVENTORY_EXPORT_TYPES, "items");
    const prepared = await exportInventory(context, type, parseInventoryExport(context, type, params));
    await recordExport(context, { id: "inventory", module: "inventory", filename: prepared.filename });
    return exportResponse(prepared);
  });
}
