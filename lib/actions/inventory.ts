"use server";

import { revalidatePath } from "next/cache";

import type { ZodError } from "zod";

import { actionFailure } from "@/lib/actions/result";
import { invalidInput, readSubmittedLines, scalarFormValues } from "@/lib/modules/finance/finance.form-data";
import { committed } from "@/lib/forms/committed";
import { requireCompanyContext } from "@/lib/context/current-user";
import * as adjustments from "@/lib/modules/inventory/documents/adjustment.service";
import * as issues from "@/lib/modules/inventory/documents/issue.service";
import * as receipts from "@/lib/modules/inventory/documents/receipt.service";
import * as returns from "@/lib/modules/inventory/documents/return.service";
import * as transfers from "@/lib/modules/inventory/documents/transfer.service";
import * as items from "@/lib/modules/inventory/items/item.service";
import * as reservations from "@/lib/modules/inventory/reservations/reservation.service";
import * as warehouses from "@/lib/modules/inventory/warehouses/warehouse.service";
import {
  adjustmentSchema,
  issueSchema,
  itemSchema,
  locationSchema,
  receiptSchema,
  reservationSchema,
  returnSchema,
  transferSchema,
  warehouseSchema,
} from "@/lib/modules/inventory/inventory.schema";

/**
 * Server actions for the Inventory module (PRD #20 §240, §250).
 *
 * A thin shell over the same services the pages call. Nothing here decides
 * authorisation: every service re-runs the whole guard sequence, so a form
 * posting straight to an action is exactly as safe as the endpoint.
 */

export type InventoryActionResult =
  | { ok: true; id?: string; message?: string; redirectTo?: string; count?: number }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

function revalidateInventory(recordPath?: string) {
  revalidatePath("/inventory", "layout");
  if (recordPath) revalidatePath(recordPath, "layout");
  revalidatePath("/dashboard");
}

/** A refusal the form can place (AUD-09 §3, §6): see `actionFailure`. */
function toResult(error: unknown): InventoryActionResult {
  return actionFailure(error, "inventory");
}

/**
 * Invalid input under canonical paths (AUD-09 §3, §7, FV-16): a line's error
 * is `lines.<index>.<field>`, the index being the row's submitted position.
 */
function invalid(error: ZodError, submitted: number[] | null = null): InventoryActionResult {
  return invalidInput(error, submitted ? { lines: submitted } : {});
}

const LINE_FIELDS = [
  "id",
  "inventoryItemId",
  "locationId",
  "fromLocationId",
  "toLocationId",
  "quantity",
  "quantityDelta",
  "notes",
  "goodsReceiptItemId",
];

/**
 * Reads a form that carries repeated line fields.
 *
 * Lines arrive as `lines.0.inventoryItemId` (or the older
 * `lines[0][inventoryItemId]`), because an HTML form has no nested objects and
 * a JSON blob in a hidden field is a thing nobody can debug from the network
 * tab. A row with no item is dropped — but every kept row remembers the index
 * it was submitted as, so its error lands on it and not on a neighbour.
 */
function formValues(formData: FormData): {
  values: Record<string, unknown>;
  lines: Record<string, string>[];
  submitted: number[];
} {
  const rows = readSubmittedLines(formData, "lines", LINE_FIELDS, (row) => (row.inventoryItemId ?? "").trim() !== "");
  return { values: scalarFormValues(formData), lines: rows.lines, submitted: rows.submitted };
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

export async function createItemAction(formData: FormData): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  const parsed = itemSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await items.createItem(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory();
  return committed(`/inventory/items/${id}`);
}

export async function updateItemAction(
  itemId: string,
  formData: FormData,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  const parsed = itemSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await items.updateItem(context, itemId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory(`/inventory/items/${itemId}`);
  return committed(`/inventory/items/${itemId}`);
}

export async function itemLifecycleAction(
  itemId: string,
  action: "archive" | "restore",
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "archive") await items.archiveItem(context, itemId);
    else await items.restoreItem(context, itemId);
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory(`/inventory/items/${itemId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Warehouses and locations                                                    */
/* -------------------------------------------------------------------------- */

export async function createWarehouseAction(
  formData: FormData,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  const parsed = warehouseSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await warehouses.createWarehouse(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory();
  return committed(`/inventory/warehouses/${id}`);
}

export async function updateWarehouseAction(
  warehouseId: string,
  formData: FormData,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  const parsed = warehouseSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await warehouses.updateWarehouse(context, warehouseId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory(`/inventory/warehouses/${warehouseId}`);
  return committed(`/inventory/warehouses/${warehouseId}`);
}

export async function warehouseLifecycleAction(
  warehouseId: string,
  action: "archive" | "restore",
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "archive") await warehouses.archiveWarehouse(context, warehouseId);
    else await warehouses.restoreWarehouse(context, warehouseId);
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory(`/inventory/warehouses/${warehouseId}`);
  return { ok: true };
}

export async function createLocationAction(
  warehouseId: string,
  formData: FormData,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  const parsed = locationSchema.safeParse({
    ...formValues(formData).values,
    isDefault:
      formData.get("isDefault") === "on" || formData.get("isDefault") === "true",
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await warehouses.createLocation(context, warehouseId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory(`/inventory/warehouses/${warehouseId}`);
  return { ok: true, message: "Location added." };
}

export async function archiveLocationAction(
  warehouseId: string,
  locationId: string,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  try {
    await warehouses.archiveLocation(context, locationId);
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory(`/inventory/warehouses/${warehouseId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Stock documents                                                             */
/* -------------------------------------------------------------------------- */

type DocumentKind = "receipts" | "issues" | "returns" | "transfers" | "adjustments";

export async function createDocumentAction(
  kind: DocumentKind,
  formData: FormData,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();
  const { values, lines, submitted } = formValues(formData);

  let id: string;
  try {
    if (kind === "receipts") {
      const parsed = receiptSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      id = (await receipts.createReceipt(context, parsed.data)).id;
    } else if (kind === "issues") {
      const parsed = issueSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      id = (await issues.createIssue(context, parsed.data)).id;
    } else if (kind === "returns") {
      const parsed = returnSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      id = (await returns.createReturn(context, parsed.data)).id;
    } else if (kind === "transfers") {
      const parsed = transferSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      id = (await transfers.createTransfer(context, parsed.data)).id;
    } else {
      const parsed = adjustmentSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      id = (await adjustments.createAdjustment(context, parsed.data)).id;
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory();
  return committed(`/inventory/${kind}/${id}`);
}

export async function updateDocumentAction(
  kind: DocumentKind,
  documentId: string,
  formData: FormData,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();
  const { values, lines, submitted } = formValues(formData);

  try {
    if (kind === "receipts") {
      const parsed = receiptSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      await receipts.updateReceipt(context, documentId, parsed.data);
    } else if (kind === "issues") {
      const parsed = issueSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      await issues.updateIssue(context, documentId, parsed.data);
    } else if (kind === "returns") {
      const parsed = returnSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      await returns.updateReturn(context, documentId, parsed.data);
    } else if (kind === "transfers") {
      const parsed = transferSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      await transfers.updateTransfer(context, documentId, parsed.data);
    } else {
      const parsed = adjustmentSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error, submitted);
      await adjustments.updateAdjustment(context, documentId, parsed.data);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory(`/inventory/${kind}/${documentId}`);
  return committed(`/inventory/${kind}/${documentId}`);
}

export type DocumentLifecycle = "post" | "cancel" | "reverse";

/**
 * Posting, cancelling and reversing, across every document kind (PRD #20 §280).
 *
 * One action rather than fifteen, because the lifecycle is genuinely the same
 * shape for all of them — only the service differs.
 */
export async function documentLifecycleAction(
  kind: DocumentKind,
  documentId: string,
  action: DocumentLifecycle,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  try {
    if (kind === "receipts") {
      if (action === "post") await receipts.postReceipt(context, documentId);
      else if (action === "cancel") await receipts.cancelReceipt(context, documentId);
      else await receipts.reverseReceipt(context, documentId);
    } else if (kind === "issues") {
      if (action === "post") await issues.postIssue(context, documentId);
      else if (action === "cancel") await issues.cancelIssue(context, documentId);
      else await issues.reverseIssue(context, documentId);
    } else if (kind === "returns") {
      if (action === "post") await returns.postReturn(context, documentId);
      else if (action === "cancel") await returns.cancelReturn(context, documentId);
      else {
        return { ok: false, error: "A posted return is corrected by an adjustment." };
      }
    } else if (kind === "transfers") {
      if (action === "post") await transfers.postTransfer(context, documentId);
      else if (action === "cancel") await transfers.cancelTransfer(context, documentId);
      else await transfers.reverseTransfer(context, documentId);
    } else {
      if (action === "post") await adjustments.postAdjustment(context, documentId);
      else if (action === "cancel") await adjustments.cancelAdjustment(context, documentId);
      else await adjustments.reverseAdjustment(context, documentId);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory(`/inventory/${kind}/${documentId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Procurement handoff                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Books an accepted Procurement delivery into stock (PRD #20 §11, §84, §255).
 *
 * It drafts an InventoryReceipt; it does not post it. Procurement remains the
 * authority on what was accepted, and Inventory remains the authority on when
 * that becomes stock — so a storeman still confirms the posting on the receipt
 * itself (PRD #20 §457).
 *
 * Only accepted quantity crosses. What was rejected went back on the lorry, and
 * booking it in would put material on the shelf that is not there (§90).
 */
export async function postFromGoodsReceiptAction(
  goodsReceiptId: string,
  formData: FormData,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();
  const { values, lines, submitted } = formValues(formData);

  const warehouseId = typeof values.warehouseId === "string" ? values.warehouseId : "";
  if (!warehouseId) {
    const message = "Choose the warehouse it is going into.";
    return { ok: false, code: "VALIDATION_ERROR", error: message, fieldErrors: { warehouseId: [message] } };
  }

  // A mapped line without a location is refused on that line, not silently
  // dropped; a delivery line mapped twice is refused rather than booked twice
  // (AUD-09 §7, FV-16).
  const fieldErrors: Record<string, string[]> = {};
  const seen = new Set<string>();
  lines.forEach((line, position) => {
    const index = submitted[position];
    if (!(line.goodsReceiptItemId ?? "").trim()) return;
    if (!(line.locationId ?? "").trim()) fieldErrors[`lines.${index}.locationId`] = ["Choose a location for this line."];
    if (seen.has(line.goodsReceiptItemId!)) fieldErrors[`lines.${index}.goodsReceiptItemId`] = ["This delivery line is already mapped."];
    seen.add(line.goodsReceiptItemId!);
  });
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Please review the highlighted lines.", fieldErrors };
  }

  const mapped = lines
    .filter((line) => (line.goodsReceiptItemId ?? "") !== "")
    .map((line) => ({
      goodsReceiptItemId: line.goodsReceiptItemId!,
      inventoryItemId: line.inventoryItemId!,
      locationId: line.locationId!,
    }));

  if (mapped.length === 0) {
    return { ok: false, code: "VALIDATION_ERROR", error: "Map at least one accepted delivery line to an inventory item." };
  }

  let id: string;
  try {
    id = (await receipts.postFromGoodsReceipt(context, goodsReceiptId, { warehouseId, lines: mapped }))
      .id;
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory();
  revalidatePath("/procurement", "layout");
  return committed(`/inventory/receipts/${id}`);
}

/* -------------------------------------------------------------------------- */
/* Reservations                                                                */
/* -------------------------------------------------------------------------- */

export async function createReservationAction(
  formData: FormData,
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  const parsed = reservationSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    id = (await reservations.createReservation(context, parsed.data)).id;
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory();
  return { ok: true, id, message: "Stock reserved." };
}

export async function reservationLifecycleAction(
  reservationId: string,
  action: "release" | "cancel",
): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "release") await reservations.release(context, reservationId);
    else await reservations.cancel(context, reservationId);
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory("/inventory/reservations");
  return { ok: true };
}

/** Releases every reservation whose date has passed (PRD #20 §163). */
export async function expireReservationsAction(): Promise<InventoryActionResult> {
  const context = await requireCompanyContext();

  let released: number;
  try {
    released = await reservations.expireOverdue(context);
  } catch (error) {
    return toResult(error);
  }

  revalidateInventory("/inventory/reservations");
  return {
    ok: true,
    count: released,
    message:
      released === 0
        ? "Nothing had expired."
        : `Released ${released} expired reservation${released === 1 ? "" : "s"}.`,
  };
}
