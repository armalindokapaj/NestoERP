import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { canSeeStock } from "./inventory.dto";
import * as adjustments from "./documents/adjustment.service";
import * as issues from "./documents/issue.service";
import * as items from "./items/item.service";
import * as movements from "./movements/movement.service";
import * as reservations from "./reservations/reservation.service";
import {
  adjustmentReasonLabels,
  itemCategoryLabels,
  itemStatusLabels,
  movementTypeLabels,
  reservationStatusLabels,
  stockLevelLabels,
  transactionStatusLabels,
} from "./inventory.status";
import type {
  BalanceListQuery,
  ItemListQuery,
  MovementListQuery,
  ReservationListQuery,
  TransactionListQuery,
} from "./inventory.schema";

/**
 * CSV export (PRD #20 §214, §215).
 *
 * The export is the list. It parses the same query, calls the same service and
 * receives the same scoped, redacted DTOs — so a reader without balance
 * permission gets a file with no stock columns rather than a file with the
 * figures in it, and a project user's file covers only their own warehouses
 * (PRD #20 §215, §391).
 *
 * Quantities are written exactly as the DTO carries them: decimal strings. A
 * spreadsheet that reopens a stock figure as a float is somebody else's
 * problem, but NESTO will not create one (PRD #20 §272).
 */

export const EXPORT_ROW_CAP = 10_000;

export type InventoryExportType =
  | "items"
  | "balances"
  | "movements"
  | "issues"
  | "reservations"
  | "adjustments";

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function exportInventory(
  context: UserContext,
  type: InventoryExportType,
  query: {
    items?: ItemListQuery;
    balances?: BalanceListQuery;
    movements?: MovementListQuery;
    transactions?: TransactionListQuery;
    reservations?: ReservationListQuery;
  },
): Promise<{ filename: string; csv: string }> {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.export");

  const stamp = new Date().toISOString().slice(0, 10);

  if (type === "items") {
    assertPermission(context, "inventory.item.view");
    const result = await items.listItems(context, {
      ...query.items!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    // Stock columns appear only for a reader who may see stock. Writing them
    // empty would imply the figure is zero (PRD #20 §20).
    const withStock = canSeeStock(context);
    const headers = [
      "SKU",
      "Name",
      "Category",
      "Unit",
      "Status",
      "Minimum stock",
      "Reorder point",
      ...(withStock ? ["On hand", "Reserved", "Available", "Level"] : []),
    ];

    return {
      filename: `inventory-items-${stamp}.csv`,
      csv: toCsv(
        headers,
        result.data.map((row) => [
          row.sku,
          row.name,
          itemCategoryLabels[row.category],
          row.baseUnit,
          itemStatusLabels[row.status],
          row.minimumStock,
          row.reorderPoint,
          ...(withStock
            ? [
                row.stock?.onHand ?? null,
                row.stock?.reserved ?? null,
                row.stock?.available ?? null,
                stockLevelLabels[row.level],
              ]
            : []),
        ]),
      ),
    };
  }

  if (type === "balances") {
    const result = await movements.listBalances(context, {
      ...query.balances!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    return {
      filename: `inventory-stock-${stamp}.csv`,
      csv: toCsv(
        ["SKU", "Item", "Warehouse", "Location", "Unit", "On hand", "Reserved", "Available"],
        result.data.map((row) => [
          row.item.sku,
          row.item.name,
          row.warehouse.code,
          row.location.code,
          row.item.baseUnit,
          row.onHand,
          row.reserved,
          row.available,
        ]),
      ),
    };
  }

  if (type === "movements") {
    const result = await movements.listMovements(context, {
      ...query.movements!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    return {
      filename: `inventory-movements-${stamp}.csv`,
      csv: toCsv(
        [
          "When",
          "Type",
          "SKU",
          "Item",
          "Warehouse",
          "Location",
          "Project",
          "Quantity",
          "Unit",
          "Source",
          "Posted by",
        ],
        result.data.map((row) => [
          row.occurredAt,
          movementTypeLabels[row.movementType],
          row.item.sku,
          row.item.name,
          row.warehouse.code,
          row.location.code,
          row.project?.code ?? null,
          // Signed, so a spreadsheet sums the column to the balance.
          row.signedQuantity,
          row.unit,
          row.source?.label ?? null,
          row.postedBy?.fullName ?? null,
        ]),
      ),
    };
  }

  if (type === "issues") {
    assertPermission(context, "inventory.issue.view");
    const result = await issues.listIssues(context, {
      ...query.transactions!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    return {
      filename: `inventory-issues-${stamp}.csv`,
      csv: toCsv(
        ["Issue", "Status", "Date", "Warehouse", "Project", "Issued to", "Lines"],
        result.data.map((row) => [
          row.issueNumber,
          transactionStatusLabels[row.status],
          row.issueDate,
          row.warehouse.code,
          row.project?.code ?? null,
          row.issuedTo?.fullName ?? null,
          row.lineCount,
        ]),
      ),
    };
  }

  if (type === "adjustments") {
    assertPermission(context, "inventory.adjustment.view");
    const result = await adjustments.listAdjustments(context, {
      ...query.transactions!,
      page: 1,
      limit: EXPORT_ROW_CAP,
    });

    return {
      filename: `inventory-adjustments-${stamp}.csv`,
      csv: toCsv(
        ["Adjustment", "Status", "Date", "Warehouse", "Reason", "Lines"],
        result.data.map((row) => [
          row.adjustmentNumber,
          transactionStatusLabels[row.status],
          row.adjustmentDate,
          row.warehouse.code,
          adjustmentReasonLabels[row.reason],
          row.lineCount,
        ]),
      ),
    };
  }

  assertPermission(context, "inventory.reservation.view");
  const result = await reservations.listReservations(context, {
    ...query.reservations!,
    page: 1,
    limit: EXPORT_ROW_CAP,
  });

  return {
    filename: `inventory-reservations-${stamp}.csv`,
    csv: toCsv(
      [
        "Reservation",
        "Status",
        "SKU",
        "Item",
        "Warehouse",
        "Location",
        "Project",
        "Reserved",
        "Fulfilled",
        "Remaining",
        "Unit",
        "Required",
        "Expires",
      ],
      result.data.map((row) => [
        row.reservationNumber,
        reservationStatusLabels[row.status],
        row.item.sku,
        row.item.name,
        row.warehouse.code,
        row.location.code,
        row.project?.code ?? null,
        row.quantity,
        row.fulfilledQuantity,
        row.remainingQuantity,
        row.item.baseUnit,
        row.requiredDate,
        row.expiresAt,
      ]),
    ),
  };
}
