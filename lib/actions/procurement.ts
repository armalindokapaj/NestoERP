"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ZodError } from "zod";

import { AccessError } from "@/lib/access/guards";
import { actionFailure } from "@/lib/actions/result";
import { invalidInput, readSubmittedLines, scalarFormValues } from "@/lib/modules/finance/finance.form-data";
import { parseDecimalInput } from "@/lib/modules/finance/finance.decimal";
import { approvalGuardFrom, type PendingCycle } from "@/lib/core/approvals/approval-guard";
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
  supplierUpdateSchema,
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
  const failure = actionFailure(error, "procurement");
  // The over-receipt question carries its lines back (PRD #19 §139).
  const lines = error instanceof AccessError ? (error.details as { lines?: unknown } | undefined)?.lines : undefined;
  return lines === undefined ? failure : { ...failure, details: lines };
}

/**
 * Invalid input under canonical paths (AUD-09 §3, §7, FV-16): a line's error
 * is `items.<index>.<field>`, the index being the row's submitted position, so
 * the editor can put it on that row.
 */
function invalid(error: ZodError, submitted: number[] | null = null): ProcurementActionResult {
  return invalidInput(error, submitted ? { items: submitted } : {});
}

/**
 * Reads a form that carries repeated line fields.
 *
 * Lines arrive as `items.0.description` (or the older `items[0][description]`),
 * because an HTML form has no nested objects and a JSON blob in a hidden field
 * is a thing nobody can debug from the network tab. A row with nothing in it is
 * dropped — but every kept row remembers the index it was submitted as, so an
 * error on it names that row and not a neighbour.
 */
function formValues(
  formData: FormData,
  kept?: (row: Record<string, string>) => boolean,
): {
  values: Record<string, unknown>;
  items: Record<string, string>[];
  submitted: number[];
} {
  const rows = readSubmittedLines(formData, "items", ITEM_FIELDS, kept ?? ((row) => (row.description ?? "").trim() !== ""));
  return { values: scalarFormValues(formData), items: rows.lines, submitted: rows.submitted };
}

const ITEM_FIELDS = [
  "id",
  "description",
  "quantity",
  "unit",
  "unitPrice",
  "estimatedUnitPrice",
  "taxRate",
  "category",
  "specification",
  "sourceRequestItemId",
  "sourceQuoteItemId",
  "rfqItemId",
  "notes",
  "purchaseOrderItemId",
  "receivedQuantity",
  "rejectedQuantity",
];

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

  const parsed = supplierUpdateSchema.safeParse(formValues(formData).values);
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

  const { values, items, submitted } = formValues(formData);
  const parsed = requestSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error, submitted);

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

  const { values, items, submitted } = formValues(formData);
  const parsed = requestSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error, submitted);

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

/**
 * `cycle` is the approval cycle — and, on a chained order, the step — the page
 * displayed: approving and rejecting name it, and the service refuses a
 * missing or replaced one inside its transaction, so a stale page cannot
 * decide a resubmission or the next step of a chain (AUD-10 §4, CW-02, CW-04,
 * CW-05). Other steps ignore it.
 */
export async function requestLifecycleAction(
  requestId: string,
  action: RequestLifecycleAction,
  note?: string,
  cycle?: PendingCycle | null,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await requests.submitRequest(context, requestId);
    else if (action === "approve") await requests.approveRequest(context, requestId, note ?? null, approvalGuardFrom(cycle));
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
  cycle?: PendingCycle | null,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const parsed = procurementReasonSchema.safeParse({ note: reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await requests.rejectRequest(context, requestId, parsed.data.note, approvalGuardFrom(cycle));
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

  const { values, items, submitted } = formValues(formData);
  const supplierIds = formData.getAll("supplierIds").filter((v): v is string => typeof v === "string");
  const parsed = rfqSchema.safeParse({ ...values, items, supplierIds });
  if (!parsed.success) return invalid(parsed.error, submitted);

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

  const { values, items, submitted } = formValues(formData);
  const supplierIds = formData.getAll("supplierIds").filter((v): v is string => typeof v === "string");
  const parsed = rfqSchema.safeParse({ ...values, items, supplierIds });
  if (!parsed.success) return invalid(parsed.error, submitted);

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

  const { values, items, submitted } = formValues(formData);
  const parsed = quoteSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error, submitted);

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

  const { values, items, submitted } = formValues(formData);
  const parsed = orderSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error, submitted);

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

  const { values, items, submitted } = formValues(formData);
  const parsed = orderSchema.safeParse({ ...values, items });
  if (!parsed.success) return invalid(parsed.error, submitted);

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
  cycle?: PendingCycle | null,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  try {
    if (action === "submit") await orders.submitOrder(context, orderId);
    else if (action === "approve") await orders.approveOrder(context, orderId, note ?? null, approvalGuardFrom(cycle));
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
  cycle?: PendingCycle | null,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();

  const parsed = procurementReasonSchema.safeParse({ note: reason });
  if (!parsed.success) return invalid(parsed.error);

  try {
    await orders.rejectOrder(context, orderId, parsed.data.note, approvalGuardFrom(cycle));
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

  // A delivery need not bring every line: a row left empty or at 0 did not
  // arrive this time and is not part of the receipt. It used to be refused as
  // "Quantity must be more than zero" under a key no row showed, which blocked
  // every delivery once one line was complete (AUD-09 §7, FV-16).
  const { values, items, submitted } = formValues(formData, (row) => {
    if (!(row.purchaseOrderItemId ?? "").trim()) return false;
    const received = parseDecimalInput(row.receivedQuantity ?? "", { label: "Received quantity", scale: 4, maxIntegerDigits: 14 });
    return !(received.ok && !/[1-9]/.test(received.value)) && (row.receivedQuantity ?? "").trim() !== "";
  });
  const parsed = receiptSchema.safeParse({
    ...values,
    acknowledgeOverReceipt:
      values.acknowledgeOverReceipt === "on" || values.acknowledgeOverReceipt === "true",
    items,
  });
  if (!parsed.success) return invalid(parsed.error, submitted);

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

/**
 * The queue decides on either record type through one action (PRD #19 §152).
 * `cycle` is the row's own approval (and the chain step it showed), so a row
 * left open while the record moved on cannot decide what replaced it
 * (AUD-10 §4, CW-04, CW-05).
 */
export async function decideApprovalAction(
  recordType: "PURCHASE_REQUEST" | "PURCHASE_ORDER",
  recordId: string,
  decision: "approve" | "reject",
  note?: string,
  cycle?: PendingCycle | null,
): Promise<ProcurementActionResult> {
  const context = await requireCompanyContext();
  const guard = approvalGuardFrom(cycle);

  try {
    if (recordType === "PURCHASE_REQUEST") {
      if (decision === "approve") await requests.approveRequest(context, recordId, note ?? null, guard);
      else {
        const parsed = procurementReasonSchema.safeParse({ note });
        if (!parsed.success) return invalid(parsed.error);
        await requests.rejectRequest(context, recordId, parsed.data.note, guard);
      }
    } else if (decision === "approve") {
      await orders.approveOrder(context, recordId, note ?? null, guard);
    } else {
      const parsed = procurementReasonSchema.safeParse({ note });
      if (!parsed.success) return invalid(parsed.error);
      await orders.rejectOrder(context, recordId, parsed.data.note, guard);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateProcurement();
  return { ok: true };
}
