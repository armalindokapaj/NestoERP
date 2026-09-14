import type {
  GoodsReceiptStatus,
  ProcurementCategory,
  ProcurementPriority,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
  RFQStatus,
  RFQSupplierStatus,
  SupplierQuoteStatus,
  SupplierStatus,
  SupplierType,
} from "@prisma/client";

/**
 * The procurement lifecycles (PRD #19 §245–§248).
 *
 * Every move is a named action, and this table is the whole truth about what
 * may follow what — no generic PATCH can set a status (PRD #19 §19). ARCHIVED
 * has no outgoing edge because leaving the archive is a restore, which returns
 * the status the record held before.
 *
 * Two rules are worth naming because they are easy to get wrong:
 *
 *   1. **An issued order may be cancelled only before anything arrives.** Once
 *      a receipt exists the order is closed short, not cancelled: the goods on
 *      site are a fact, and cancelling would deny them (PRD #19 §128, §129).
 *   2. **Receiving is derived from quantity, not clicked.** An order moves to
 *      PARTIALLY_RECEIVED or RECEIVED because of what the receipts add up to
 *      (PRD #19 §141).
 */

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

export const SUPPLIER_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export const SUPPLIER_TYPES = ["COMPANY", "INDIVIDUAL", "PUBLIC_ENTITY", "OTHER"] as const;

export const supplierStatusLabels: Record<SupplierStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export const supplierTypeLabels: Record<SupplierType, string> = {
  COMPANY: "Company",
  INDIVIDUAL: "Individual",
  PUBLIC_ENTITY: "Public entity",
  OTHER: "Other",
};

/** Only an active supplier may be named on new buying (PRD #19 §28). */
export function isSupplierSelectable(status: SupplierStatus): boolean {
  return status === "ACTIVE";
}

/* -------------------------------------------------------------------------- */
/* Purchase requests                                                           */
/* -------------------------------------------------------------------------- */

export const REQUEST_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "IN_SOURCING",
  "PARTIALLY_ORDERED",
  "ORDERED",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const requestStatusLabels: Record<PurchaseRequestStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  IN_SOURCING: "In sourcing",
  PARTIALLY_ORDERED: "Partially ordered",
  ORDERED: "Ordered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const priorityLabels: Record<ProcurementPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const CATEGORIES = [
  "MATERIALS",
  "EQUIPMENT",
  "SUBCONTRACT",
  "SERVICES",
  "LOGISTICS",
  "OFFICE",
  "OTHER",
] as const;

export const categoryLabels: Record<ProcurementCategory, string> = {
  MATERIALS: "Materials",
  EQUIPMENT: "Equipment",
  SUBCONTRACT: "Subcontract",
  SERVICES: "Services",
  LOGISTICS: "Logistics",
  OFFICE: "Office",
  OTHER: "Other",
};

const REQUEST_TRANSITIONS: Record<PurchaseRequestStatus, PurchaseRequestStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED", "ARCHIVED"],
  // DRAFT: returned for revision (PRD #41 §48).
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT", "CANCELLED"],
  APPROVED: ["IN_SOURCING", "CANCELLED"],
  // A rejected request goes back to the desk it came from, and may be resubmitted.
  REJECTED: ["DRAFT", "PENDING_APPROVAL", "CANCELLED", "ARCHIVED"],
  IN_SOURCING: ["PARTIALLY_ORDERED", "ORDERED", "CANCELLED"],
  PARTIALLY_ORDERED: ["ORDERED", "CANCELLED"],
  ORDERED: ["COMPLETED"],
  COMPLETED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionRequestStatus(
  from: PurchaseRequestStatus,
  to: PurchaseRequestStatus,
): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

/** A request's lines are its ask; they freeze once somebody has approved it. */
export function isRequestEditable(status: PurchaseRequestStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export function isRequestSubmittable(status: PurchaseRequestStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export function isRequestArchivable(status: PurchaseRequestStatus): boolean {
  return status === "DRAFT" || status === "CANCELLED" || status === "COMPLETED";
}

export function isRequestCancellable(status: PurchaseRequestStatus): boolean {
  return canTransitionRequestStatus(status, "CANCELLED");
}

/** Sourcing may begin once the ask is approved (PRD #19 §61). */
export function acceptsSourcing(status: PurchaseRequestStatus): boolean {
  return status === "APPROVED" || status === "IN_SOURCING" || status === "PARTIALLY_ORDERED";
}

/* -------------------------------------------------------------------------- */
/* RFQs and quotes                                                             */
/* -------------------------------------------------------------------------- */

export const RFQ_STATUSES = ["DRAFT", "ISSUED", "CLOSED", "CANCELLED"] as const;

export const rfqStatusLabels: Record<RFQStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export const rfqSupplierStatusLabels: Record<RFQSupplierStatus, string> = {
  INVITED: "Invited",
  RESPONDED: "Responded",
  DECLINED: "Declined",
  DISQUALIFIED: "Disqualified",
};

const RFQ_TRANSITIONS: Record<RFQStatus, RFQStatus[]> = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransitionRfqStatus(from: RFQStatus, to: RFQStatus): boolean {
  return RFQ_TRANSITIONS[from].includes(to);
}

/** An issued enquiry's items are fixed: suppliers priced what they were sent. */
export function isRfqEditable(status: RFQStatus): boolean {
  return status === "DRAFT";
}

export function acceptsQuotes(status: RFQStatus): boolean {
  return status === "ISSUED";
}

export function isRfqSupplierEditable(status: RFQStatus): boolean {
  return status === "DRAFT" || status === "ISSUED";
}

export const QUOTE_STATUSES = [
  "DRAFT",
  "RECEIVED",
  "DISQUALIFIED",
  "SELECTED",
  "NOT_SELECTED",
] as const;

export const quoteStatusLabels: Record<SupplierQuoteStatus, string> = {
  DRAFT: "Draft",
  RECEIVED: "Received",
  DISQUALIFIED: "Disqualified",
  SELECTED: "Selected",
  NOT_SELECTED: "Not selected",
};

const QUOTE_TRANSITIONS: Record<SupplierQuoteStatus, SupplierQuoteStatus[]> = {
  DRAFT: ["RECEIVED", "DISQUALIFIED"],
  RECEIVED: ["SELECTED", "NOT_SELECTED", "DISQUALIFIED"],
  DISQUALIFIED: [],
  SELECTED: [],
  NOT_SELECTED: [],
};

export function canTransitionQuoteStatus(
  from: SupplierQuoteStatus,
  to: SupplierQuoteStatus,
): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function isQuoteEditable(status: SupplierQuoteStatus): boolean {
  return status === "DRAFT" || status === "RECEIVED";
}

/** Only a received quote can win: a draft is not an answer (PRD #19 §92). */
export function isQuoteSelectable(status: SupplierQuoteStatus): boolean {
  return status === "RECEIVED";
}

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

export const ORDER_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "ISSUED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const orderStatusLabels: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ISSUED: "Issued",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

const ORDER_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED", "ARCHIVED"],
  // DRAFT: returned for revision (PRD #41 §48).
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT", "CANCELLED"],
  APPROVED: ["ISSUED", "CANCELLED"],
  REJECTED: ["DRAFT", "PENDING_APPROVAL", "CANCELLED", "ARCHIVED"],
  ISSUED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["RECEIVED", "CLOSED"],
  RECEIVED: ["CLOSED"],
  CLOSED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransitionOrderStatus(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** An order's lines are the commitment; they freeze once somebody approves it. */
export function isOrderEditable(status: PurchaseOrderStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export function isOrderSubmittable(status: PurchaseOrderStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

export function isOrderArchivable(status: PurchaseOrderStatus): boolean {
  return status === "DRAFT" || status === "CLOSED" || status === "CANCELLED";
}

/** Goods may be booked in against an order the supplier has actually been sent. */
export function acceptsReceipts(status: PurchaseOrderStatus): boolean {
  return status === "ISSUED" || status === "PARTIALLY_RECEIVED";
}

export function isOrderClosable(status: PurchaseOrderStatus): boolean {
  return status === "PARTIALLY_RECEIVED" || status === "RECEIVED";
}

/**
 * Where an order lands given what has arrived (PRD #19 §141).
 *
 * Derived from quantity rather than clicked, so the status cannot disagree with
 * the receipts listed beneath it.
 */
export function receiptStatusFor(
  current: PurchaseOrderStatus,
  fraction: number,
): PurchaseOrderStatus {
  if (current !== "ISSUED" && current !== "PARTIALLY_RECEIVED" && current !== "RECEIVED") {
    return current;
  }
  if (fraction <= 0) return "ISSUED";
  if (fraction >= 1) return "RECEIVED";
  return "PARTIALLY_RECEIVED";
}

/* -------------------------------------------------------------------------- */
/* Receipts                                                                    */
/* -------------------------------------------------------------------------- */

export const receiptStatusLabels: Record<GoodsReceiptStatus, string> = {
  RECORDED: "Recorded",
  VOIDED: "Voided",
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

/** Past its required date and not yet satisfied (PRD #19 §184, §185). */
export function isOverdue(requiredDate: Date | null, satisfied: boolean, today: Date): boolean {
  if (!requiredDate || satisfied) return false;
  return daysBetween(today, requiredDate) < 0;
}
