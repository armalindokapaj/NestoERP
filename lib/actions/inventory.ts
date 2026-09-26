"use server";

import { revalidatePath } from "next/cache";

import { AccessError } from "@/lib/access/guards";
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
  | { ok: true; id?: string; message?: string; redirectTo?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

function revalidateInventory(recordPath?: string) {
  revalidatePath("/inventory", "layout");
  if (recordPath) revalidatePath(recordPath, "layout");
  revalidatePath("/dashboard");
}

function toResult(error: unknown): InventoryActionResult {
  if (error instanceof AccessError) {
    const details = error.details as { code?: string } | undefined;
    return { ok: false, error: error.message, code: details?.code };
  }

  console.error("[inventory] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function invalid(error: { flatten(): { fieldErrors: unknown } }): InventoryActionResult {
  return {
    ok: false,
    error: "Please review the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/**
 * Reads a form that carries repeated line fields.
 *
 * Lines arrive as `lines[0][inventoryItemId]` and so on, because an HTML form
 * has no nested objects and a JSON blob in a hidden field is a thing nobody can
 * debug from the network tab.
 */
function formValues(formData: FormData): {
  values: Record<string, unknown>;
  lines: Record<string, string>[];
} {
  const values: Record<string, unknown> = {};
  const rows = new Map<number, Record<string, string>>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;

    const match = /^lines\[(\d+)\]\[(\w+)\]$/.exec(key);
    if (match) {
      const index = Number.parseInt(match[1]!, 10);
      const row = rows.get(index) ?? {};
      row[match[2]!] = value;
      rows.set(index, row);
      continue;
    }

    values[key] = value;
  }

  const lines = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row)
    // A line the user cleared is dropped rather than failing validation.
    .filter((row) => (row.inventoryItemId ?? "").trim() !== "");

  return { values, lines };
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
  const { values, lines } = formValues(formData);

  let id: string;
  try {
    if (kind === "receipts") {
      const parsed = receiptSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
      id = (await receipts.createReceipt(context, parsed.data)).id;
    } else if (kind === "issues") {
      const parsed = issueSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
      id = (await issues.createIssue(context, parsed.data)).id;
    } else if (kind === "returns") {
      const parsed = returnSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
      id = (await returns.createReturn(context, parsed.data)).id;
    } else if (kind === "transfers") {
      const parsed = transferSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
      id = (await transfers.createTransfer(context, parsed.data)).id;
    } else {
      const parsed = adjustmentSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
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
  const { values, lines } = formValues(formData);

  try {
    if (kind === "receipts") {
      const parsed = receiptSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
      await receipts.updateReceipt(context, documentId, parsed.data);
    } else if (kind === "issues") {
      const parsed = issueSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
      await issues.updateIssue(context, documentId, parsed.data);
    } else if (kind === "returns") {
      const parsed = returnSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
      await returns.updateReturn(context, documentId, parsed.data);
    } else if (kind === "transfers") {
      const parsed = transferSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
      await transfers.updateTransfer(context, documentId, parsed.data);
    } else {
      const parsed = adjustmentSchema.safeParse({ ...values, lines });
      if (!parsed.success) return invalid(parsed.error);
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
  const { values, lines } = formValues(formData);

  const warehouseId = typeof values.warehouseId === "string" ? values.warehouseId : "";
  if (!warehouseId) {
    return { ok: false, error: "Choose the warehouse it is going into." };
  }

  const mapped = lines
    .filter((line) => (line.goodsReceiptItemId ?? "") !== "" && (line.locationId ?? "") !== "")
    .map((line) => ({
      goodsReceiptItemId: line.goodsReceiptItemId!,
      inventoryItemId: line.inventoryItemId!,
      locationId: line.locationId!,
    }));

  if (mapped.length === 0) {
    return { ok: false, error: "Map at least one accepted delivery line to an inventory item." };
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
    message:
      released === 0
        ? "Nothing had expired."
        : `Released ${released} expired reservation${released === 1 ? "" : "s"}.`,
  };
}
