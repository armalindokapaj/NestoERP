import type { InvoiceStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The invoice lifecycle (PRD #15 §245; PRD #41 §48; PRD #49 §132).
 *
 * Issuance, not settlement. Whether an invoice has been paid is derived from
 * its payments at read time, so a fully paid invoice stays `SENT` and there is
 * no `PAID` state to move into (PRD #15 §42, §45).
 *
 * Deciding an invoice is Finance's approval authority rather than the record's
 * own: either the module-wide `finance.approval.decide` or the invoice's own
 * approve or reject grant, as `canApproveType` and `canRejectType` answer it.
 * Returning for revision is a rejection that sends the invoice back to `DRAFT`
 * for a new cycle, so it takes the reject grant. The service also checks, above
 * the write, that a cycle is pending and that nobody decides their own
 * submission — neither of which a table can say.
 *
 * Nothing moves a `REJECTED` invoice back to `DRAFT`: it is corrected where it
 * stands and submitted again.
 *
 * Cancelling a sent invoice carries a second condition — no recorded payments —
 * which the service checks inside the same transaction (PRD #15 §67).
 *
 * Archiving is kept to records that are not money somebody owes, and restore
 * returns the invoice to the status it was archived from, read from
 * `preArchiveStatus` — which is why it may lead to any state archive leads out
 * of (PRD #15 §68, §69).
 */
export type InvoiceTransitionAction = "submit" | "approve" | "reject" | "return" | "mark_sent" | "cancel" | "archive" | "restore";

const ARCHIVABLE: InvoiceStatus[] = ["DRAFT", "REJECTED", "CANCELLED"];

export const invoiceMachine = defineStateMachine<InvoiceStatus, InvoiceTransitionAction>({
  key: "invoice",
  model: "invoice",
  field: "status",
  states: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT", "CANCELLED", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "submit", from: ["DRAFT", "REJECTED"], to: "PENDING_APPROVAL", permission: "finance.invoice.submit" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: ["finance.approval.decide", "finance.invoice.approve"], freezes: "the client, project, dates, currency and lines" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: ["finance.approval.decide", "finance.invoice.reject"], requiresReason: true },
    { action: "return", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: ["finance.approval.decide", "finance.invoice.reject"], requiresReason: true },
    { action: "mark_sent", from: ["APPROVED"], to: "SENT", permission: "finance.invoice.mark_sent" },
    { action: "cancel", from: ["DRAFT", "REJECTED", "APPROVED", "SENT"], to: "CANCELLED", permission: "finance.invoice.cancel" },
    { action: "archive", from: ARCHIVABLE, to: "ARCHIVED", permission: "finance.invoice.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ARCHIVABLE, permission: "finance.invoice.restore" },
  ],
});
