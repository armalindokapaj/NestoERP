import type {
  InventoryItemCategory,
  InventoryItemStatus,
  InventoryLocationStatus,
  InventoryTransactionStatus,
  StockAdjustmentReason,
  StockMovementType,
  StockReservationStatus,
  WarehouseStatus,
  WarehouseType,
} from "@prisma/client";

import { transitionFor } from "@/lib/core/state/machine";
import { STOCK_DOCUMENT_STEPS } from "./documents/document.transitions";
import { stockReservationMachine } from "./reservations/reservation.machine";

/**
 * Inventory lifecycles (PRD #20 §280).
 *
 * Every stock document shares one shape: **drafted, then posted**. Writing a
 * delivery note down and committing it to the ledger are different acts, done
 * by different people, and a document that could only exist in its final state
 * would force somebody to get it right first time (PRD #20 §281).
 *
 * After posting there is no edit — only a reversal, which writes a new ledger
 * row rather than erasing one (PRD #20 §70, §100).
 *
 * Which states each step is legal from is declared once, with the machines
 * (`documents/document.transitions.ts`, `reservations/reservation.machine.ts`);
 * the `is…Postable`-style helpers below answer from those declarations rather
 * than keeping a second copy that could drift from them.
 */

export const TRANSACTION_STATUSES = ["DRAFT", "POSTED", "CANCELLED", "REVERSED"] as const;

export const transactionStatusLabels: Record<InventoryTransactionStatus, string> = {
  DRAFT: "Draft",
  POSTED: "Posted",
  CANCELLED: "Cancelled",
  REVERSED: "Reversed",
};

export function isTransactionEditable(status: InventoryTransactionStatus): boolean {
  return status === "DRAFT";
}

export function isTransactionPostable(status: InventoryTransactionStatus): boolean {
  return STOCK_DOCUMENT_STEPS.post.from.includes(status);
}

/** Cancel before posting; reverse after. They are not the same act (§99, §100). */
export function isTransactionCancellable(status: InventoryTransactionStatus): boolean {
  return STOCK_DOCUMENT_STEPS.cancel.from.includes(status);
}

export function isTransactionReversible(status: InventoryTransactionStatus): boolean {
  return STOCK_DOCUMENT_STEPS.reverse.from.includes(status);
}

/* -------------------------------------------------------------------------- */
/* Items, warehouses, locations                                                */
/* -------------------------------------------------------------------------- */

export const ITEM_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

export const itemStatusLabels: Record<InventoryItemStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export const ITEM_CATEGORIES = [
  "MATERIAL",
  "EQUIPMENT",
  "TOOL",
  "CONSUMABLE",
  "SPARE_PART",
  "OFFICE",
  "OTHER",
] as const;

export const itemCategoryLabels: Record<InventoryItemCategory, string> = {
  MATERIAL: "Material",
  EQUIPMENT: "Equipment",
  TOOL: "Tool",
  CONSUMABLE: "Consumable",
  SPARE_PART: "Spare part",
  OFFICE: "Office",
  OTHER: "Other",
};

export const WAREHOUSE_TYPES = ["CENTRAL", "PROJECT_SITE", "OFFICE", "TEMPORARY", "OTHER"] as const;

export const warehouseTypeLabels: Record<WarehouseType, string> = {
  CENTRAL: "Central store",
  PROJECT_SITE: "Project site",
  OFFICE: "Office",
  TEMPORARY: "Temporary",
  OTHER: "Other",
};

export const WAREHOUSE_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

export const warehouseStatusLabels: Record<WarehouseStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export const locationStatusLabels: Record<InventoryLocationStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

/** Only an active warehouse can take or give stock (PRD #20 §55). */
export function isWarehouseUsable(status: WarehouseStatus): boolean {
  return status === "ACTIVE";
}

export function isItemUsable(status: InventoryItemStatus): boolean {
  return status === "ACTIVE";
}

/* -------------------------------------------------------------------------- */
/* Movements                                                                   */
/* -------------------------------------------------------------------------- */

export const MOVEMENT_TYPES = [
  "RECEIPT",
  "ISSUE",
  "RETURN_TO_STOCK",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "REVERSAL",
] as const;

export const movementTypeLabels: Record<StockMovementType, string> = {
  RECEIPT: "Receipt",
  ISSUE: "Issue",
  RETURN_TO_STOCK: "Return to stock",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  ADJUSTMENT_IN: "Adjustment in",
  ADJUSTMENT_OUT: "Adjustment out",
  REVERSAL: "Reversal",
};

/* -------------------------------------------------------------------------- */
/* Adjustments and reservations                                                */
/* -------------------------------------------------------------------------- */

export const ADJUSTMENT_REASONS = [
  "OPENING_BALANCE",
  "PHYSICAL_COUNT",
  "DAMAGE",
  "LOSS",
  "FOUND",
  "CORRECTION",
  "OTHER",
] as const;

export const adjustmentReasonLabels: Record<StockAdjustmentReason, string> = {
  OPENING_BALANCE: "Opening balance",
  PHYSICAL_COUNT: "Physical count",
  DAMAGE: "Damage",
  LOSS: "Loss",
  FOUND: "Found",
  CORRECTION: "Correction",
  OTHER: "Other",
};

/**
 * An opening balance is the one adjustment allowed to create stock from
 * nothing, because by definition it has no history behind it (PRD #20 §149).
 */
export function allowsNegativeResult(reason: StockAdjustmentReason): boolean {
  return reason === "OPENING_BALANCE";
}

export const RESERVATION_STATUSES = [
  "ACTIVE",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "RELEASED",
  "CANCELLED",
  "EXPIRED",
] as const;

export const reservationStatusLabels: Record<StockReservationStatus, string> = {
  ACTIVE: "Active",
  PARTIALLY_FULFILLED: "Partly fulfilled",
  FULFILLED: "Fulfilled",
  RELEASED: "Released",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/** A reservation still holding stock back from available (PRD #20 §166). */
export function isReservationHolding(status: StockReservationStatus): boolean {
  return status === "ACTIVE" || status === "PARTIALLY_FULFILLED";
}

export function isReservationClosable(status: StockReservationStatus): boolean {
  return transitionFor(stockReservationMachine, "release")!.from.includes(status);
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/**
 * Low stock, said precisely (PRD #20 §167–§169).
 *
 *   out of stock  nothing on hand at all
 *   low           at or below the reorder point
 *   below minimum at or below the minimum, which is the harder floor
 *
 * An item with neither threshold set is never "low": the product does not
 * invent a number the company never chose (PRD #20 §168).
 */
export type StockLevel = "OUT_OF_STOCK" | "BELOW_MINIMUM" | "LOW" | "OK" | "NOT_TRACKED";

export function stockLevelFor(input: {
  onHand: number;
  minimumStock: number | null;
  reorderPoint: number | null;
}): StockLevel {
  if (input.onHand <= 0) return "OUT_OF_STOCK";
  if (input.minimumStock === null && input.reorderPoint === null) return "NOT_TRACKED";
  if (input.minimumStock !== null && input.onHand <= input.minimumStock) return "BELOW_MINIMUM";
  if (input.reorderPoint !== null && input.onHand <= input.reorderPoint) return "LOW";
  return "OK";
}

export const stockLevelLabels: Record<StockLevel, string> = {
  OUT_OF_STOCK: "Out of stock",
  BELOW_MINIMUM: "Below minimum",
  LOW: "Low",
  OK: "In stock",
  NOT_TRACKED: "No threshold set",
};

export function needsAttention(level: StockLevel): boolean {
  return level === "OUT_OF_STOCK" || level === "BELOW_MINIMUM" || level === "LOW";
}
