import { z } from "zod";

import { compareDecimal, isZeroDecimal } from "@/lib/modules/finance/finance.decimal";
import { MAX_LINE_ITEMS } from "@/lib/modules/finance/finance.form-data";
import {
  businessDate,
  decimalString,
  optionalBusinessDate,
  optionalDecimalString,
  positive,
  RATE_RULE,
} from "@/lib/modules/finance/finance.fields";
import {
  optionalBoolean,
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

/*
 * Quantities go through the one decimal rule every module shares (AUD-09 §4,
 * FV-06). The old first-comma replace read `1,000` as 1 — a thousand bags of
 * cement booked as one — and a float decided "more than zero".
 */

/** A quantity: positive, at most four decimals (PRD #20 §72). */
const quantityString = decimalString("Quantity", RATE_RULE).refine(positive, {
  message: "Quantity must be more than zero",
});

/** A signed quantity, for adjustments, where negative writes stock off (§147). */
const deltaString = decimalString("Adjustment", { ...RATE_RULE, allowNegative: true }).refine(
  (value) => !isZeroDecimal(value),
  { message: "An adjustment of zero changes nothing" },
);

/** A stock level that may be left unset (no minimum): empty is "none", not 0. */
const optionalQuantityString = optionalDecimalString("Stock level", RATE_RULE);

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
    // No create default on the shared schema: an edit that leaves status out
    // keeps it (AUD-09 §4, FV-05); a create without one is active (service).
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
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
      compareDecimal(value.reorderPoint, value.minimumStock) >= 0,
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
  view: z.enum(["all", "low-stock", "archived"]).default("all")
    // An unknown value from a stale link shows the default list, not an error page (AUD-08 §3).
    .catch("all"),
  status: z.array(z.enum(ITEM_STATUSES)).optional(),
  category: z.array(z.enum(ITEM_CATEGORIES)).optional(),
  warehouseId: z.string().optional(),
  sort: z
    .enum(["name-asc", "sku-asc", "updated-desc", "created-desc", "stock-asc"])
    .default("name-asc")
    // An unknown value from a stale link shows the default list, not an error page (AUD-08 §3).
    .catch("name-asc"),
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
    // As for items: absent keeps the saved status on an edit (FV-05).
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
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
  sort: z.enum(["code-asc", "name-asc", "updated-desc"]).default("code-asc")
    // An unknown value from a stale link shows the default list, not an error page (AUD-08 §3).
    .catch("code-asc"),
});

export type WarehouseListQuery = z.infer<typeof warehouseListQuerySchema>;

export const locationSchema = z.object({
  code: requiredText(1, 40, "Location code"),
  name: optionalText(200),
  description: optionalText(1000),
  // "false" is false (`z.coerce.boolean()` read the string as true).
  isDefault: optionalBoolean.transform((value) => value ?? false),
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
  lines: z.array(documentLine).min(1, "A receipt needs at least one line").max(MAX_LINE_ITEMS),
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
  lines: z.array(documentLine).min(1, "An issue needs at least one line").max(MAX_LINE_ITEMS),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type IssueInput = z.infer<typeof issueSchema>;

export const returnSchema = z.object({
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  projectId: z.string().trim().min(1, "Choose the project it is coming back from"),
  returnDate: businessDate,
  returnedByMemberId: optionalId,
  notes: optionalText(2000),
  lines: z.array(documentLine).min(1, "A return needs at least one line").max(MAX_LINE_ITEMS),
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
      .min(1, "A transfer needs at least one line")
      .max(MAX_LINE_ITEMS),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    // Moving stock to where it already is writes two movements that cancel
    // out and tells nobody anything (PRD #20 §135). Said on the line it is
    // about (AUD-09 §7, FV-16), not on the list.
    value.lines.forEach((line, index) => {
      if (line.fromLocationId === line.toLocationId) {
        ctx.addIssue({
          code: "custom",
          message: "A line cannot move stock to the location it is already in.",
          path: ["lines", index, "toLocationId"],
        });
      }
    });
  });

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
    .min(1, "An adjustment needs at least one line")
    .max(MAX_LINE_ITEMS),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

/* -------------------------------------------------------------------------- */
/* Reservations                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A reservation's dates are calendar dates in order (AUD-09 §4, FV-07): a hold
 * that expires before the day it is needed holds nothing.
 */
export const reservationSchema = z
  .object({
    inventoryItemId: z.string().trim().min(1, "Choose an item"),
    warehouseId: z.string().trim().min(1, "Choose a warehouse"),
    locationId: z.string().trim().min(1, "Choose a location"),
    projectId: optionalId,
    quantity: quantityString,
    requiredDate: optionalBusinessDate,
    expiresAt: optionalBusinessDate,
  })
  .refine((value) => !value.requiredDate || !value.expiresAt || value.expiresAt.getTime() >= value.requiredDate.getTime(), {
    message: "The reservation cannot expire before the date it is needed.",
    path: ["expiresAt"],
  });

export type ReservationInput = z.infer<typeof reservationSchema>;

/* -------------------------------------------------------------------------- */
/* List queries                                                                */
/* -------------------------------------------------------------------------- */

/** The movement and document sorts, named so a header sort control can check them (AUD-08 §4). */
export const MOVEMENT_SORT_KEYS = ["occurred-desc", "occurred-asc"] as const;
export const TRANSACTION_SORT_KEYS = ["date-desc", "date-asc", "number-asc", "updated-desc"] as const;

export const movementListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  movementType: z.array(z.enum(MOVEMENT_TYPES)).optional(),
  inventoryItemId: z.string().optional(),
  warehouseId: z.string().optional(),
  locationId: z.string().optional(),
  projectId: z.string().optional(),
  from: optionalBusinessDate,
  to: optionalBusinessDate,
  sort: z.enum(MOVEMENT_SORT_KEYS).default("occurred-desc")
    // An unknown value from a stale link shows the default list, not an error page (AUD-08 §3).
    .catch("occurred-desc"),
});

export type MovementListQuery = z.infer<typeof movementListQuerySchema>;

export const transactionListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(TRANSACTION_STATUSES)).optional(),
  warehouseId: z.string().optional(),
  projectId: z.string().optional(),
  reason: optionalEnum(ADJUSTMENT_REASONS),
  sort: z.enum(TRANSACTION_SORT_KEYS).default("date-desc")
    // An unknown value from a stale link shows the default list, not an error page (AUD-08 §3).
    .catch("date-desc"),
});

export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;

export const reservationListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(RESERVATION_STATUSES)).optional(),
  warehouseId: z.string().optional(),
  projectId: z.string().optional(),
  inventoryItemId: z.string().optional(),
  sort: z.enum(["created-desc", "required-asc", "expires-asc"]).default("created-desc")
    // An unknown value from a stale link shows the default list, not an error page (AUD-08 §3).
    .catch("created-desc"),
});

export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>;

export const balanceListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  warehouseId: z.string().optional(),
  locationId: z.string().optional(),
  inventoryItemId: z.string().optional(),
  /** Hides rows that hold nothing, which is most of them (PRD #20 §180). */
  // `?heldOnly=false` (or 0) means false: `z.coerce.boolean` read every non-empty string as true (AUD-08 §3).
  heldOnly: z
    .preprocess((value) => (value === "false" || value === "0" ? false : value === "true" || value === "1" ? true : value), z.boolean().optional())
    .default(true)
    .catch(true),
  sort: z.enum(["item-asc", "available-desc", "available-asc"]).default("item-asc")
    // An unknown value from a stale link shows the default list, not an error page (AUD-08 §3).
    .catch("item-asc"),
});

export type BalanceListQuery = z.infer<typeof balanceListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Lifecycle notes                                                             */
/* -------------------------------------------------------------------------- */

export const inventoryNoteSchema = z.object({ note: optionalText(2000) });
export const inventoryReasonSchema = z.object({ note: requiredText(3, 2000, "Reason") });
