import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { toItemRef, toWarehouseRef } from "../inventory.dto";
import { ZERO, quantityString } from "../inventory.quantity";
import {
  buildAdjustmentScopeWhere,
  buildBalanceScopeWhere,
  buildMovementScopeWhere,
  buildWarehouseScopeWhere,
} from "../inventory.scope";
import type {
  ProjectConsumptionRow,
  StockByWarehouseRow,
} from "../inventory.types";

/**
 * Inventory reports (PRD #20 §205–§213).
 *
 * Everything is scoped to the reader's warehouses, so two people on this page
 * see different totals and both are right (PRD #20 §215).
 *
 * Quantities are only ever summed within one item, never across items: adding
 * bags of cement to tonnes of steel produces a number that means nothing
 * (PRD #20 §22).
 */

export type InventoryReports = {
  stockByWarehouse: StockByWarehouseRow[];
  adjustmentsByReason: { reason: string; count: number }[];
  movementsByType: { movementType: string; count: number }[];
  topHeldItems: { item: ReturnType<typeof toItemRef>; onHand: string; locations: number }[];
};

export async function inventoryReports(context: UserContext): Promise<InventoryReports> {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.report.view");

  const [warehouses, balances, adjustments, movements] = await Promise.all([
    prisma.warehouse.findMany({
      where: { AND: [buildWarehouseScopeWhere(context), { status: { not: "ARCHIVED" } }] },
      select: { id: true, code: true, name: true, warehouseType: true },
      orderBy: { code: "asc" },
    }),
    prisma.inventoryBalance.findMany({
      where: { AND: [buildBalanceScopeWhere(context), { onHandQuantity: { gt: 0 } }] },
      select: {
        warehouseId: true,
        onHandQuantity: true,
        reservedQuantity: true,
        inventoryItemId: true,
        inventoryItem: { select: { id: true, sku: true, name: true, baseUnit: true } },
      },
    }),
    can(context, "inventory.adjustment.view")
      ? prisma.stockAdjustment.groupBy({
          by: ["reason"],
          where: { AND: [buildAdjustmentScopeWhere(context), { status: "POSTED" }] },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.stockMovement.groupBy({
      by: ["movementType"],
      where: buildMovementScopeWhere(context),
      _count: { _all: true },
    }),
  ]);

  /*
   * Totals per warehouse are a count of *lines*, not a sum across units: the
   * quantity column adds bags to tonnes, so the figure is presented as "how
   * much is sitting here" only within one item (PRD #20 §22).
   */
  const byWarehouse = new Map<string, { onHand: Prisma.Decimal; reserved: Prisma.Decimal; items: Set<string> }>();
  const byItem = new Map<string, { item: (typeof balances)[number]["inventoryItem"]; onHand: Prisma.Decimal; locations: number }>();

  for (const row of balances) {
    const warehouse = byWarehouse.get(row.warehouseId) ?? {
      onHand: ZERO,
      reserved: ZERO,
      items: new Set<string>(),
    };
    warehouse.onHand = warehouse.onHand.plus(row.onHandQuantity);
    warehouse.reserved = warehouse.reserved.plus(row.reservedQuantity);
    warehouse.items.add(row.inventoryItemId);
    byWarehouse.set(row.warehouseId, warehouse);

    const item = byItem.get(row.inventoryItemId) ?? {
      item: row.inventoryItem,
      onHand: ZERO,
      locations: 0,
    };
    item.onHand = item.onHand.plus(row.onHandQuantity);
    item.locations += 1;
    byItem.set(row.inventoryItemId, item);
  }

  return {
    stockByWarehouse: warehouses.map((warehouse) => {
      const totals = byWarehouse.get(warehouse.id);
      return {
        warehouse: toWarehouseRef(warehouse)!,
        distinctItems: totals?.items.size ?? 0,
        totalOnHand: quantityString(totals?.onHand ?? ZERO),
        totalReserved: quantityString(totals?.reserved ?? ZERO),
      };
    }),
    adjustmentsByReason: adjustments.map((row) => ({
      reason: row.reason,
      count: row._count._all,
    })),
    movementsByType: movements.map((row) => ({
      movementType: row.movementType,
      count: row._count._all,
    })),
    topHeldItems: [...byItem.values()]
      .sort((a, b) => b.onHand.comparedTo(a.onHand))
      .slice(0, 10)
      .map((entry) => ({
        item: toItemRef(entry.item),
        onHand: quantityString(entry.onHand),
        locations: entry.locations,
      })),
  };
}

/**
 * What one project has actually consumed (PRD #20 §182, §185).
 *
 * Issued less returned, per item. A project that took forty bags and brought
 * six back consumed thirty-four, and reporting the forty would overstate every
 * job that ever returns anything.
 */
export async function projectConsumption(
  context: UserContext,
  projectId: string,
): Promise<ProjectConsumptionRow[]> {
  if (!can(context, "inventory.movement.view")) return [];

  const rows = await prisma.stockMovement.findMany({
    where: {
      AND: [
        buildMovementScopeWhere(context),
        { projectId, movementType: { in: ["ISSUE", "RETURN_TO_STOCK"] } },
      ],
    },
    select: {
      movementType: true,
      quantity: true,
      inventoryItem: { select: { id: true, sku: true, name: true, baseUnit: true } },
      inventoryItemId: true,
    },
  });

  const byItem = new Map<
    string,
    { item: (typeof rows)[number]["inventoryItem"]; issued: Prisma.Decimal; returned: Prisma.Decimal }
  >();

  for (const row of rows) {
    const entry = byItem.get(row.inventoryItemId) ?? {
      item: row.inventoryItem,
      issued: ZERO,
      returned: ZERO,
    };

    if (row.movementType === "ISSUE") entry.issued = entry.issued.plus(row.quantity);
    else entry.returned = entry.returned.plus(row.quantity);

    byItem.set(row.inventoryItemId, entry);
  }

  return [...byItem.values()]
    .map((entry) => ({
      item: toItemRef(entry.item)!,
      issued: quantityString(entry.issued),
      returned: quantityString(entry.returned),
      netIssued: quantityString(entry.issued.minus(entry.returned)),
    }))
    .sort((a, b) => Number(b.netIssued) - Number(a.netIssued));
}
