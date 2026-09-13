import { withContext } from "@/lib/api/respond";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import {
  exportInventory,
  type InventoryExportType,
} from "@/lib/modules/inventory/inventory.export";
import {
  balanceListQuerySchema,
  itemListQuerySchema,
  movementListQuerySchema,
  reservationListQuerySchema,
  transactionListQuerySchema,
} from "@/lib/modules/inventory/inventory.schema";

/**
 * CSV export (PRD #20 §214, §215).
 *
 * The same query, the same services and the same scope as the screen — so the
 * file can never contain a row or a column the reader could not see. The
 * `inventory.export` grant is checked on top of the view permission for
 * whatever is being exported (PRD #20 §215).
 */
const TYPES = [
  "items",
  "balances",
  "movements",
  "issues",
  "reservations",
  "adjustments",
] as const;

function list(params: URLSearchParams, key: string): string[] | undefined {
  const raw = params.get(key);
  if (!raw) return undefined;
  const values = raw.split(",").filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const params = url.searchParams;
    const raw = params.get("type");
    const type: InventoryExportType = (TYPES as readonly string[]).includes(raw ?? "")
      ? (raw as InventoryExportType)
      : "items";

    const shared = {
      search: params.get("search") ?? undefined,
      warehouseId: params.get("warehouseId") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      inventoryItemId: params.get("inventoryItemId") ?? undefined,
    };

    const { filename, csv } = await exportInventory(context, type, {
      items: itemListQuerySchema.parse({
        search: shared.search,
        view: params.get("view") ?? undefined,
        status: list(params, "status"),
        category: list(params, "category"),
        warehouseId: shared.warehouseId,
        sort: params.get("sort") ?? undefined,
      }),
      balances: balanceListQuerySchema.parse({
        search: shared.search,
        warehouseId: shared.warehouseId,
        locationId: params.get("locationId") ?? undefined,
        inventoryItemId: shared.inventoryItemId,
        heldOnly: params.get("heldOnly") ?? undefined,
      }),
      movements: movementListQuerySchema.parse({
        search: shared.search,
        movementType: list(params, "movementType"),
        warehouseId: shared.warehouseId,
        locationId: params.get("locationId") ?? undefined,
        inventoryItemId: shared.inventoryItemId,
        projectId: shared.projectId,
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
      }),
      transactions: transactionListQuerySchema.parse({
        search: shared.search,
        status: list(params, "status"),
        warehouseId: shared.warehouseId,
        projectId: shared.projectId,
        reason: params.get("reason") ?? undefined,
      }),
      reservations: reservationListQuerySchema.parse({
        search: shared.search,
        status: list(params, "status"),
        warehouseId: shared.warehouseId,
        projectId: shared.projectId,
        inventoryItemId: shared.inventoryItemId,
      }),
    });

    /*
     * Who took a copy of company data, and which one (PRD #28 §130). The row
     * counts and the filter values are not recorded — the evidence is that an
     * export happened, not a second copy of what left.
     */
    await recordUserAction(context, {
      actionKey: AuditAction.REPORT_EXPORTED_CSV,
      entity: { type: "export", id: "inventory", label: filename },
      metadata: { module: "inventory" },
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
