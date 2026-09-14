import type { InvoiceStatus, Prisma } from "@prisma/client";

/**
 * Invoice workflow transitions (PRD #15 §245).
 *
 * ARCHIVED is deliberately unreachable through this table: archiving is its
 * own action with its own guard, and restore reads `preArchiveStatus` rather
 * than picking a status to land on (PRD #15 §68, §69).
 *
 * `SENT → CANCELLED` is listed here but carries a second condition the table
 * cannot express — no recorded payments — which the service checks
 * (PRD #15 §67).
 */
const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  // DRAFT: returned for revision (PRD #41 §48).
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["SENT", "CANCELLED"],
  REJECTED: ["DRAFT", "PENDING_APPROVAL", "CANCELLED"],
  SENT: ["CANCELLED"],
  CANCELLED: [],
  ARCHIVED: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/** Financial fields are frozen the moment an invoice leaves draft (PRD #15 §59, §60). */
export const EDITABLE_INVOICE_STATUSES: InvoiceStatus[] = ["DRAFT", "REJECTED"];

export function isInvoiceEditable(status: InvoiceStatus): boolean {
  return EDITABLE_INVOICE_STATUSES.includes(status);
}

export function isInvoiceSubmittable(status: InvoiceStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

/**
 * Archiving is not a way of closing out live financial records (PRD #15 §68).
 *
 * An approved or sent invoice is money somebody owes; it stays visible.
 */
export const ARCHIVABLE_INVOICE_STATUSES: InvoiceStatus[] = ["DRAFT", "REJECTED", "CANCELLED"];

export function isInvoiceArchivable(status: InvoiceStatus): boolean {
  return ARCHIVABLE_INVOICE_STATUSES.includes(status);
}

export const CANCELLABLE_INVOICE_STATUSES: InvoiceStatus[] = [
  "DRAFT",
  "REJECTED",
  "APPROVED",
  "SENT",
];

/** Payments may only be recorded against an invoice that has gone out (PRD #15 §66). */
export function acceptsPayment(status: InvoiceStatus): boolean {
  return status === "SENT";
}

export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SENT: "Sent",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

/**
 * Settlement, derived and never stored (PRD #15 §42, §45).
 *
 * A fully paid invoice stays `SENT`: issuance workflow and cash settlement are
 * two different facts, and storing one inside the other is how a paid invoice
 * ends up unable to be cancelled for the wrong reason.
 */
export type SettlementStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

export function invoiceSettlement(input: {
  status: InvoiceStatus;
  paid: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  dueDate: Date;
  now?: Date;
}): SettlementStatus {
  const now = input.now ?? new Date();

  if (input.outstanding.lessThanOrEqualTo(0)) return "PAID";

  // Overdue is a state of a *sent* invoice: a draft with a past due date is a
  // drafting mistake, not a debt (PRD #15 §44).
  if (input.status === "SENT" && input.dueDate.getTime() < now.getTime()) return "OVERDUE";

  return input.paid.greaterThan(0) ? "PARTIALLY_PAID" : "UNPAID";
}

/** Expenses have no overdue state: nobody chases the company for its own cost. */
export type ExpenseSettlementStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";

export function expenseSettlement(input: {
  paid: Prisma.Decimal;
  outstanding: Prisma.Decimal;
}): ExpenseSettlementStatus {
  if (input.outstanding.lessThanOrEqualTo(0)) return "PAID";
  return input.paid.greaterThan(0) ? "PARTIALLY_PAID" : "UNPAID";
}

export const settlementLabels: Record<SettlementStatus, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
};
