import { z } from "zod";

import { businessDate, optionalBusinessDate } from "@/lib/modules/finance/finance.fields";
import {
  optionalEnum,
  optionalId,
  optionalText,
  requiredText,
} from "@/lib/modules/shared/fields";
import { paginationSchema } from "@/lib/modules/shared/list-query";
import {
  ADJUSTMENT_REASONS,
  ITEM_CATEGORIES,
  ITEM_STATUSES,
  MOVEMENT_TYPES,
  RESERVATION_STATUSES,
  TRANSACTION_STATUSES,
  WAREHOUSE_STATUSES,
  WAREHOUSE_TYPES,
} from "./inventory.status";

/**
 * Inventory validation (PRD #20 §273–§279).
 *
 * Quantities arrive as strings and stay strings until Prisma turns them into
 * decimals. Parsing them into JavaScript numbers on the way in would round a
 * stock figure before anybody could check it (PRD #20 §242).
 *
 * No schema here accepts a status. Documents move through named actions —
 * post, cancel, reverse — so there is nothing for a generic update to set.
 */

/** A quantity: positive, at most four decimals (PRD #20 §72). */
const quantityString = z
  .string()
  .trim()
  .min(1, "Enter a quantity")
  .transform((value) => value.replace(",", "."))
  .refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value), {
    message: "Quantity must be a number with at most 4 decimal places",
  })
  .refine((value) => Number.parseFloat(value) > 0, { message: "Quantity must be more than zero" });

/** A signed quantity, for adjustments, where negative writes stock off (§147). */
const deltaString = z
  .string()
  .trim()
  .min(1, "Enter an adjustment")
  .transform((value) => value.replace(",", "."))
  .refine((value) => /^-?\d{1,14}(\.\d{1,4})?$/.test(value), {
    message: "Enter a number with at most 4 decimal places",
  })
  .refine((value) => Number.parseFloat(value) !== 0, {
    message: "An adjustment of zero changes nothing",
  });

const optionalQuantityString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value.replace(",", ".")))
  .refine((value) => value === undefined || /^\d{1,14}(\.\d{1,4})?$/.test(value), {
    message: "Enter a number with at most 4 decimal places",
  });

/** Every item is measured in something; "each" is a unit, "" is a gap (§31). */
const unit = requiredText(1, 24, "Unit");

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

export const itemSchema = z
  .object({
    sku: requiredText(1, 60, "SKU"),
    name: requiredText(2, 200, "Item name"),
    description: optionalText(2000),
    category: z.enum(ITEM_CATEGORIES),
    baseUnit: unit,
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
    minimumStock: optionalQuantityString,
    reorderPoint: optionalQuantityString,
    defaultWarehouseId: optionalId,
    defaultLocationId: optionalId,
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine(
    (value) =>
      value.minimumStock === undefined ||
      value.reorderPoint === undefined ||
      Number.parseFloat(value.reorderPoint) >= Number.parseFloat(value.minimumStock),
    {
      // The reorder point is when to buy; the minimum is the floor you must not
      // cross. A reorder point below the minimum would order too late by
      // construction (PRD #20 §168).
      message: "The reorder point should be at or above the minimum stock level.",
      path: ["reorderPoint"],
    },
  );

export type ItemInput = z.infer<typeof itemSchema>;

export const itemListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "low-stock", "archived"]).default("all"),
  status: z.array(z.enum(ITEM_STATUSES)).optional(),
  category: z.array(z.enum(ITEM_CATEGORIES)).optional(),
  warehouseId: z.string().optional(),
  sort: z
    .enum(["name-asc", "sku-asc", "updated-desc", "created-desc", "stock-asc"])
    .default("name-asc"),
});

export type ItemListQuery = z.infer<typeof itemListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Warehouses and locations                                                    */
/* -------------------------------------------------------------------------- */

export const warehouseSchema = z
  .object({
    code: requiredText(1, 40, "Warehouse code"),
    name: requiredText(2, 200, "Warehouse name"),
    description: optionalText(2000),
    warehouseType: z.enum(WAREHOUSE_TYPES),
    projectId: optionalId,
    address: optionalText(400),
    city: optionalText(120),
    country: optionalText(120),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine((value) => value.warehouseType !== "PROJECT_SITE" || value.projectId !== undefined, {
    // A site store with no site is a store nobody can find (PRD #20 §53).
    message: "A project site warehouse needs a project.",
    path: ["projectId"],
  });

export type WarehouseInput = z.infer<typeof warehouseSchema>;

export const warehouseListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(WAREHOUSE_STATUSES)).optional(),
  warehouseType: z.array(z.enum(WAREHOUSE_TYPES)).optional(),
  projectId: z.string().optional(),
  sort: z.enum(["code-asc", "name-asc", "updated-desc"]).default("code-asc"),
});

export type WarehouseListQuery = z.infer<typeof warehouseListQuerySchema>;

export const locationSchema = z.object({
  code: requiredText(1, 40, "Location code"),
  name: optionalText(200),
  description: optionalText(1000),
  isDefault: z.coerce.boolean().optional().default(false),
});

export type LocationInput = z.infer<typeof locationSchema>;

/* -------------------------------------------------------------------------- */
/* Stock documents                                                             */
/* -------------------------------------------------------------------------- */

const documentLine = z.object({
  id: optionalId,
  inventoryItemId: z.string().trim().min(1, "Choose an item"),
  locationId: z.string().trim().min(1, "Choose a location"),
  quantity: quantityString,
  notes: optionalText(500),
});

export const receiptSchema = z.object({
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  receiptDate: businessDate,
  notes: optionalText(2000),
  lines: z.array(documentLine).min(1, "A receipt needs at least one line"),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type ReceiptInput = z.infer<typeof receiptSchema>;

export const issueSchema = z.object({
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  projectId: optionalId,
  issueDate: businessDate,
  issuedToMemberId: optionalId,
  requestedByMemberId: optionalId,
  notes: optionalText(2000),
  lines: z.array(documentLine).min(1, "An issue needs at least one line"),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type IssueInput = z.infer<typeof issueSchema>;

export const returnSchema = z.object({
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  projectId: z.string().trim().min(1, "Choose the project it is coming back from"),
  returnDate: businessDate,
  returnedByMemberId: optionalId,
  notes: optionalText(2000),
  lines: z.array(documentLine).min(1, "A return needs at least one line"),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type ReturnInput = z.infer<typeof returnSchema>;

export const transferSchema = z
  .object({
    fromWarehouseId: z.string().trim().min(1, "Choose where it is coming from"),
    toWarehouseId: z.string().trim().min(1, "Choose where it is going"),
    transferDate: businessDate,
    notes: optionalText(2000),
    lines: z
      .array(
        z.object({
          id: optionalId,
          inventoryItemId: z.string().trim().min(1, "Choose an item"),
          fromLocationId: z.string().trim().min(1, "Choose a source location"),
          toLocationId: z.string().trim().min(1, "Choose a destination location"),
          quantity: quantityString,
          notes: optionalText(500),
        }),
      )
      .min(1, "A transfer needs at least one line"),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine(
    (value) => value.lines.every((line) => line.fromLocationId !== line.toLocationId),
    {
      // Moving stock to where it already is writes two movements that cancel
      // out and tells nobody anything (PRD #20 §135).
      message: "A line cannot move stock to the location it is already in.",
      path: ["lines"],
    },
  );

export type TransferInput = z.infer<typeof transferSchema>;

export const adjustmentSchema = z.object({
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  adjustmentDate: businessDate,
  reason: z.enum(ADJUSTMENT_REASONS),
  notes: optionalText(2000),
  lines: z
    .array(
      z.object({
        id: optionalId,
        inventoryItemId: z.string().trim().min(1, "Choose an item"),
        locationId: z.string().trim().min(1, "Choose a location"),
        quantityDelta: deltaString,
        notes: optionalText(500),
      }),
    )
    .min(1, "An adjustment needs at least one line"),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

/* -------------------------------------------------------------------------- */
/* Reservations                                                                */
/* -------------------------------------------------------------------------- */

export const reservationSchema = z.object({
  inventoryItemId: z.string().trim().min(1, "Choose an item"),
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  locationId: z.string().trim().min(1, "Choose a location"),
  projectId: optionalId,
  quantity: quantityString,
  requiredDate: optionalBusinessDate,
  expiresAt: optionalBusinessDate,
});

export type ReservationInput = z.infer<typeof reservationSchema>;

/* -------------------------------------------------------------------------- */
/* List queries                                                                */
/* -------------------------------------------------------------------------- */

export const movementListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  movementType: z.array(z.enum(MOVEMENT_TYPES)).optional(),
  inventoryItemId: z.string().optional(),
  warehouseId: z.string().optional(),
  locationId: z.string().optional(),
  projectId: z.string().optional(),
  from: optionalBusinessDate,
  to: optionalBusinessDate,
  sort: z.enum(["occurred-desc", "occurred-asc"]).default("occurred-desc"),
});

export type MovementListQuery = z.infer<typeof movementListQuerySchema>;

export const transactionListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(TRANSACTION_STATUSES)).optional(),
  warehouseId: z.string().optional(),
  projectId: z.string().optional(),
  reason: optionalEnum(ADJUSTMENT_REASONS),
  sort: z.enum(["date-desc", "date-asc", "number-asc", "updated-desc"]).default("date-desc"),
});

export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

export const reservationListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(RESERVATION_STATUSES)).optional(),
  warehouseId: z.string().optional(),
  projectId: z.string().optional(),
  inventoryItemId: z.string().optional(),
  sort: z.enum(["created-desc", "required-asc", "expires-asc"]).default("created-desc"),
});

export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>;

export const balanceListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  warehouseId: z.string().optional(),
  locationId: z.string().optional(),
  inventoryItemId: z.string().optional(),
  /** Hides rows that hold nothing, which is most of them (PRD #20 §180). */
  heldOnly: z.coerce.boolean().optional().default(true),
  sort: z.enum(["item-asc", "available-desc", "available-asc"]).default("item-asc"),
});

export type BalanceListQuery = z.infer<typeof balanceListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Lifecycle notes                                                             */
/* -------------------------------------------------------------------------- */

export const inventoryNoteSchema = z.object({ note: optionalText(2000) });
export const inventoryReasonSchema = z.object({ note: requiredText(3, 2000, "Reason") });
