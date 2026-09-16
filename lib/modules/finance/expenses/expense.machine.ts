import type { ExpenseStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The expense lifecycle (PRD #15 §246; PRD #41 §48; PRD #49 §132).
 *
 * An expense becomes actual cost when it is approved, not when it is paid
 * (PRD #15 §118), so `APPROVED` is where the amounts stop moving — and there is
 * no `PAID` state: settlement is derived from payments at read time.
 *
 * Deciding an expense is Finance's approval authority rather than the record's
 * own: either the module-wide `finance.approval.decide` or the expense's own
 * approve or reject grant, as `canApproveType` and `canRejectType` answer it.
 * Returning for revision is a rejection that sends the expense back to `DRAFT`
 * for a new cycle, so it takes the reject grant. The service also checks, above
 * the write, that a cycle is pending and that nobody decides their own
 * submission.
 *
 * Nothing moves a `REJECTED` expense back to `DRAFT`: it is corrected where it
 * stands and submitted again.
 *
 * Cancelling an approved expense carries a second condition — no recorded
 * payments — which the service checks inside the same transaction
 * (PRD #15 §101).
 *
 * Approved cost is never archived, since budget vs actual is calculated from
 * it; restore returns the expense to the status it was archived from, read
 * from `preArchiveStatus` (PRD #15 §102).
 */
export type ExpenseTransitionAction = "submit" | "approve" | "reject" | "return" | "cancel" | "archive" | "restore";

const ARCHIVABLE: ExpenseStatus[] = ["DRAFT", "REJECTED", "CANCELLED"];

export const expenseMachine = defineStateMachine<ExpenseStatus, ExpenseTransitionAction>({
  key: "expense",
  model: "expense",
  field: "status",
  states: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED", "ARCHIVED"],
  terminal: [],
  transitions: [
    { action: "submit", from: ["DRAFT", "REJECTED"], to: "PENDING_APPROVAL", permission: "finance.expense.submit" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: ["finance.approval.decide", "finance.expense.approve"], freezes: "the whole expense" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: ["finance.approval.decide", "finance.expense.reject"], requiresReason: true },
    { action: "return", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: ["finance.approval.decide", "finance.expense.reject"], requiresReason: true },
    { action: "cancel", from: ["DRAFT", "REJECTED", "APPROVED"], to: "CANCELLED", permission: "finance.expense.cancel" },
    { action: "archive", from: ARCHIVABLE, to: "ARCHIVED", permission: "finance.expense.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ARCHIVABLE, permission: "finance.expense.restore" },
  ],
});
