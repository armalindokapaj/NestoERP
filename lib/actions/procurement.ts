"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AccessError } from "@/lib/access/guards";
import { committed } from "@/lib/forms/committed";
import { requireCompanyContext } from "@/lib/context/current-user";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import * as quotes from "@/lib/modules/procurement/quotes/quote.service";
import * as receipts from "@/lib/modules/procurement/receipts/receipt.service";
import * as requests from "@/lib/modules/procurement/requests/request.service";
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";
import * as suppliers from "@/lib/modules/procurement/suppliers/supplier.service";
import {
  orderSchema,
  procurementReasonSchema,
  quoteDisqualifySchema,
  quoteSchema,
  receiptSchema,
  receiptVoidSchema,
  requestSchema,
  rfqSchema,
  supplierSchema,
} from "@/lib/modules/procurement/procurement.schema";

/**
 * Server actions for the Procurement module (PRD #19 §215, §223).
 *
 * A thin shell over the same services the API routes call. Nothing here decides
 * authorisation: every service re-runs the whole guard sequence, so a form
 * posting straight to an action is exactly as safe as the endpoint.
 */

export type ProcurementActionResult =
  | { ok: true; id?: string; message?: string; code?: string; details?: unknown; redirectTo?: string }
  | {
      ok: false;
      error: string;
      code?: string;
      details?: unknown;
      fieldErrors?: Record<string, string[]>;
    };

function revalidateProcurement(recordPath?: string) {
  revalidatePath("/procurement", "layout");
  if (recordPath) revalidatePath(recordPath, "layout");
  revalidatePath("/dashboard");
}

/**
 * Turns a service failure into something a form can render.
 *
 * `code` and `details` travel with the message because two of the module's
 * conflicts are questions rather than refusals: receiving more than was
 * ordered, and a supplier that looks like one already on file. The form
 * re-asks with a confirmation instead of simply failing (PRD #19 §31, §139).
 */
function toResult(error: unknown): ProcurementActionResult {
  if (error instanceof AccessError) {
    const details = error.details as { code?: string; lines?: unknown } | undefined;
    return { ok: false, error: error.message, code: details?.code, details: details?.lines };
  }

  console.error("[procurement] action failed", error);
  return { ok: false, error: "We couldn't save your changes. Please try again." };
}

function invalid(error: { flatten(): { fieldErrors: unknown } }): ProcurementActionResult {
  return {
    ok: false,
    error: "Please review the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/**
 * Reads a form that carries repeated line fields.
 *
 * Lines arrive as `items[0][description]`, `items[0][quantity]` and so on,
 * because an HTML form has no nested objects and a JSON blob in a hidden field
 * is a thing nobody can debug from the network tab.
 */
function formValues(formData: FormData): {
  values: Record<string, unknown>;
  items: Record<string, string>[];
} {
  const values: Record<string, unknown> = {};
  const rows = new Map<number, Record<string, string>>();

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;

    const match = /^items\[(\d+)\]\[(\w+)\]$/.exec(key);
    if (match) {
      const index = Number.parseInt(match[1]!, 10);
      const row = rows.get(index) ?? {};
      row[match[2]!] = value;
      rows.set(index, row);
      continue;
    }

    values[key] = value;
  }

  const items = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row)
    // A line the user cleared is dropped rather than failing validation.
    .filter((row) => (row.description ?? "").trim() !== "" || (row.purchaseOrderItemId ?? "") !== "");

  return { values, items };
}

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

export async function createSupplierAction(formData: FormData): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const parsed = supplierSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    const supplier = await suppliers.createSupplier(context, parsed.data);
    id = supplier.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement();
  return committed(`/procurement/suppliers/${id}`);
}

export async function updateSupplierAction(
  supplierId: string,
  formData: FormData,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const parsed = supplierSchema.safeParse(formValues(formData).values);
  if (!parsed.success) return invalid(parsed.error);

  try {
    await suppliers.updateSupplier(context, supplierId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/suppliers/${supplierId}`);
  return committed(`/procurement/suppliers/${supplierId}`);
}

export async function supplierLifecycleAction(
  supplierId: string,
  action: "archive" | "restore",
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "archive") await suppliers.archiveSupplier(context, supplierId);
    else await suppliers.restoreSupplier(context, supplierId);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/suppliers/${supplierId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Purchase requests                                                           */
/* -------------------------------------------------------------------------- */

export async function createRequestAction(formData: FormData): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const { values, items } = formValues(formData);
  const parsed = requestSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    const request = await requests.createRequest(context, parsed.data);
    id = request.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement();
  return committed(`/procurement/requests/${id}`);
}

export async function updateRequestAction(
  requestId: string,
  formData: FormData,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const { values, items } = formValues(formData);
  const parsed = requestSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await requests.updateRequest(context, requestId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/requests/${requestId}`);
  return committed(`/procurement/requests/${requestId}`);
}

export type RequestLifecycleAction =
  | "submit"
  | "approve"
  | "start-sourcing"
  | "archive"
  | "restore";

export async function requestLifecycleAction(
  requestId: string,
  action: RequestLifecycleAction,
  note?: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await requests.submitRequest(context, requestId);
    else if (action === "approve") await requests.approveRequest(context, requestId, note ?? null);
    else if (action === "start-sourcing") await requests.startSourcing(context, requestId);
    else if (action === "archive") await requests.archiveRequest(context, requestId);
    else await requests.restoreRequest(context, requestId);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/requests/${requestId}`);
  return { ok: true };
}

export async function rejectRequestAction(
  requestId: string,
  reason: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const parsed = procurementReasonSchema.safeParse({ note: reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await requests.rejectRequest(context, requestId, parsed.data.note);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/requests/${requestId}`);
  return { ok: true };
}

export async function cancelRequestAction(
  requestId: string,
  note: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    await requests.cancelRequest(context, requestId, note.trim() === "" ? null : note);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/requests/${requestId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* RFQs and quotes                                                             */
/* -------------------------------------------------------------------------- */

export async function createRfqAction(formData: FormData): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const { values, items } = formValues(formData);
  const supplierIds = formData.getAll("supplierIds").filter((v): v is string => typeof v === "string");
  const parsed = rfqSchema.safeParse({ ...values, items, supplierIds });
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    const rfq = await rfqs.createRfq(context, parsed.data);
    id = rfq.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement();
  return committed(`/procurement/rfqs/${id}`);
}

export async function updateRfqAction(
  rfqId: string,
  formData: FormData,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const { values, items } = formValues(formData);
  const supplierIds = formData.getAll("supplierIds").filter((v): v is string => typeof v === "string");
  const parsed = rfqSchema.safeParse({ ...values, items, supplierIds });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await rfqs.updateRfq(context, rfqId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/rfqs/${rfqId}`);
  return committed(`/procurement/rfqs/${rfqId}`);
}

export type RfqLifecycleAction = "issue" | "close" | "cancel";

export async function rfqLifecycleAction(
  rfqId: string,
  action: RfqLifecycleAction,
  note?: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "issue") await rfqs.issueRfq(context, rfqId);
    else if (action === "close") await rfqs.closeRfq(context, rfqId);
    else await rfqs.cancelRfq(context, rfqId, note ?? null);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/rfqs/${rfqId}`);
  return { ok: true };
}

export async function inviteSupplierAction(
  rfqId: string,
  supplierId: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    await rfqs.inviteSupplier(context, rfqId, supplierId);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/rfqs/${rfqId}`);
  return { ok: true };
}

export async function recordQuoteAction(
  rfqId: string,
  formData: FormData,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const { values, items } = formValues(formData);
  const parsed = quoteSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    const quote = await quotes.createQuote(context, rfqId, parsed.data);
    id = quote.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/rfqs/${rfqId}`);
  return { ok: true, id };
}

export async function selectQuoteAction(
  rfqId: string,
  quoteId: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    await quotes.selectQuote(context, quoteId);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/rfqs/${rfqId}`);
  return { ok: true };
}

export async function disqualifyQuoteAction(
  rfqId: string,
  quoteId: string,
  reason: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const parsed = quoteDisqualifySchema.safeParse({ reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await quotes.disqualifyQuote(context, quoteId, parsed.data.reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/rfqs/${rfqId}`);
  return { ok: true };
}

/** Raises the order the winning quote priced (PRD #19 §106). */
export async function orderFromQuoteAction(quoteId: string): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  let id: string;
  try {
    const order = await orders.draftFromQuote(context, quoteId);
    id = order.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement();
  redirect(`/procurement/orders/${id}`);
}

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

export async function createOrderAction(formData: FormData): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const { values, items } = formValues(formData);
  const parsed = orderSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error);

  let id: string;
  try {
    const order = await orders.createOrder(context, parsed.data);
    id = order.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement();
  return committed(`/procurement/orders/${id}`);
}

export async function updateOrderAction(
  orderId: string,
  formData: FormData,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const { values, items } = formValues(formData);
  const parsed = orderSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await orders.updateOrder(context, orderId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/orders/${orderId}`);
  return committed(`/procurement/orders/${orderId}`);
}

export type OrderLifecycleAction =
  | "submit"
  | "approve"
  | "issue"
  | "close"
  | "archive"
  | "restore";

export async function orderLifecycleAction(
  orderId: string,
  action: OrderLifecycleAction,
  note?: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await orders.submitOrder(context, orderId);
    else if (action === "approve") await orders.approveOrder(context, orderId, note ?? null);
    else if (action === "issue") await orders.issueOrder(context, orderId);
    else if (action === "close") await orders.closeOrder(context, orderId, note ?? null);
    else if (action === "archive") await orders.archiveOrder(context, orderId);
    else await orders.restoreOrder(context, orderId);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/orders/${orderId}`);
  return { ok: true };
}

export async function rejectOrderAction(
  orderId: string,
  reason: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const parsed = procurementReasonSchema.safeParse({ note: reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await orders.rejectOrder(context, orderId, parsed.data.note);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/orders/${orderId}`);
  return { ok: true };
}

export async function cancelOrderAction(
  orderId: string,
  note: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    await orders.cancelOrder(context, orderId, note.trim() === "" ? null : note);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/orders/${orderId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Goods receipts                                                              */
/* -------------------------------------------------------------------------- */

export async function recordReceiptAction(
  orderId: string,
  formData: FormData,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const { values, items } = formValues(formData);
  const parsed = receiptSchema.safeParse({
    ...values,
    acknowledgeOverReceipt:
      values.acknowledgeOverReceipt === "on" || values.acknowledgeOverReceipt === "true",
    items: items.map((item) => ({ ...item, rejectedQuantity: item.rejectedQuantity ?? "0" })),
  });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await receipts.recordReceipt(context, orderId, parsed.data);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/orders/${orderId}`);
  return { ok: true, message: "Delivery recorded." };
}

export async function voidReceiptAction(
  orderId: string,
  receiptId: string,
  reason: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const parsed = receiptVoidSchema.safeParse({ reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await receipts.voidReceipt(context, receiptId, parsed.data.reason);
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement(`/procurement/orders/${orderId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Approvals                                                                   */
/* -------------------------------------------------------------------------- */

/** The queue decides on either record type through one action (PRD #19 §152). */
export async function decideApprovalAction(
  recordType: "PURCHASE_REQUEST" | "PURCHASE_ORDER",
  recordId: string,
  decision: "approve" | "reject",
  note?: string,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    if (recordType === "PURCHASE_REQUEST") {
      if (decision === "approve") await requests.approveRequest(context, recordId, note ?? null);
      else {
        const parsed = procurementReasonSchema.safeParse({ note });
        if (!parsed.success) return invalid(parsed.error);
        await requests.rejectRequest(context, recordId, parsed.data.note);
      }
    } else if (decision === "approve") {
      await orders.approveOrder(context, recordId, note ?? null);
    } else {
      const parsed = procurementReasonSchema.safeParse({ note });
      if (!parsed.success) return invalid(parsed.error);
      await orders.rejectOrder(context, recordId, parsed.data.note);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement();
  return { ok: true };
}
