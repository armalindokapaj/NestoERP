import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { canSeeStock } from "../inventory.dto";
import {
  buildBalanceScopeWhere,
  buildIssueScopeWhere,
  buildItemScopeWhere,
  buildMovementScopeWhere,
  buildReceiptScopeWhere,
  buildReservationScopeWhere,
  buildWarehouseScopeWhere,
} from "../inventory.scope";
import { itemListQuerySchema, transactionListQuerySchema, reservationListQuerySchema } from "../inventory.schema";
import type { InventoryAttentionDTO, InventoryOverviewDTO } from "../inventory.types";
import * as items from "../items/item.service";
import * as receipts from "../documents/receipt.service";
import * as issues from "../documents/issue.service";
import * as reservations from "../reservations/reservation.service";

/**
 * The Inventory overview (PRD #20 §21–§24).
 *
 * Every figure is counted through the reader's own warehouse scope, so a site
 * storeman and a head-office buyer see different numbers and both are right.
 *
 * There is deliberately no total stock value. V0.1 has no costing method, so a
 * currency figure would be a number nobody could defend (PRD #20 §186).
 */
export async function inventoryOverview(context: UserContext): Promise<InventoryOverviewDTO> {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.view");

  const seeItems = can(context, "inventory.item.view");
  const seeStock = canSeeStock(context);
  const seeMovements = can(context, "inventory.movement.view");
  const seeDocuments = can(context, "inventory.receipt.view") || can(context, "inventory.issue.view");
  const seeReservations = can(context, "inventory.reservation.view");

  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const [activeItems, warehouses, heldRows, draftReceipts, draftIssues, movements, activeReservations] =
    await Promise.all([
      seeItems
        ? prisma.inventoryItem.count({
            where: { AND: [buildItemScopeWhere(context), { status: "ACTIVE", archivedAt: null }] },
          })
        : Promise.resolve(0),
      can(context, "inventory.warehouse.view")
        ? prisma.warehouse.count({
            where: { AND: [buildWarehouseScopeWhere(context), { status: "ACTIVE" }] },
          })
        : Promise.resolve(0),
      seeStock
        ? prisma.inventoryBalance.groupBy({
            by: ["inventoryItemId"],
            where: { AND: [buildBalanceScopeWhere(context), { onHandQuantity: { gt: 0 } }] },
          })
        : Promise.resolve([]),
      can(context, "inventory.receipt.view")
        ? prisma.inventoryReceipt.count({
            where: { AND: [buildReceiptScopeWhere(context), { status: "DRAFT" }] },
          })
        : Promise.resolve(0),
      can(context, "inventory.issue.view")
        ? prisma.stockIssue.count({
            where: { AND: [buildIssueScopeWhere(context), { status: "DRAFT" }] },
          })
        : Promise.resolve(0),
      seeMovements
        ? prisma.stockMovement.count({
            where: { AND: [buildMovementScopeWhere(context), { occurredAt: { gte: monthStart } }] },
          })
        : Promise.resolve(0),
      seeReservations
        ? prisma.stockReservation.count({
            where: {
              AND: [
                buildReservationScopeWhere(context),
                { status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } },
              ],
            },
          })
        : Promise.resolve(0),
    ]);

  // Low and out-of-stock are comparisons between two columns, so they are
  // counted from the item list rather than filtered in SQL (PRD #20 §167).
  const lowStock = seeStock && seeItems
    ? await items.listItems(context, itemListQuerySchema.parse({ view: "low-stock", limit: 100 }))
    : { data: [] as Awaited<ReturnType<typeof items.listItems>>["data"] };

  return {
    visible: {
      items: seeItems,
      stock: seeStock,
      movements: seeMovements,
      documents: seeDocuments,
      reservations: seeReservations,
    },
    activeItems,
    warehouses,
    itemsHeld: heldRows.length,
    lowStockItems: lowStock.data.filter((item) => item.level !== "OUT_OF_STOCK").length,
    outOfStockItems: lowStock.data.filter((item) => item.level === "OUT_OF_STOCK").length,
    draftDocuments: draftReceipts + draftIssues,
    movementsThisMonth: movements,
    activeReservations,
  };
}

/** What needs somebody's attention today (PRD #20 §21). */
export async function inventoryAttention(
  context: UserContext,
): Promise<InventoryAttentionDTO> {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.view");

  const [lowStock, draftReceipts, draftIssues, expiring] = await Promise.all([
    canSeeStock(context) && can(context, "inventory.item.view")
      ? items.listItems(context, itemListQuerySchema.parse({ view: "low-stock", limit: 5 }))
      : Promise.resolve({ data: [] }),
    can(context, "inventory.receipt.view")
      ? receipts.listReceipts(context, transactionListQuerySchema.parse({ status: ["DRAFT"], limit: 5 }))
      : Promise.resolve({ data: [] }),
    can(context, "inventory.issue.view")
      ? issues.listIssues(context, transactionListQuerySchema.parse({ status: ["DRAFT"], limit: 5 }))
      : Promise.resolve({ data: [] }),
    can(context, "inventory.reservation.view")
      ? reservations.listReservations(
          context,
          reservationListQuerySchema.parse({
            status: ["ACTIVE", "PARTIALLY_FULFILLED"],
            sort: "expires-asc",
            limit: 5,
          }),
        )
      : Promise.resolve({ data: [] }),
  ]);

  return {
    lowStock: lowStock.data,
    draftReceipts: draftReceipts.data,
    draftIssues: draftIssues.data,
    expiringReservations: expiring.data.filter((row) => row.expiresAt !== null),
  };
}
