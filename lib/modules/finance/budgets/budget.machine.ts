import type { BudgetStatus } from "@prisma/client";

import { defineStateMachine } from "@/lib/core/state/machine";

/**
 * The project budget lifecycle (PRD #15 §247; PRD #41 §48; PRD #49 §132).
 *
 * An approved budget leads nowhere. It is never edited and never re-approved;
 * changing it means opening the next version, which is a new row starting in
 * `DRAFT` rather than a transition of this one (PRD #15 §111, §115). Standing
 * the previous version down is `isCurrent`, not a status, and happens in the
 * approval's own transaction.
 *
 * `version` on this model is that budget version number — v1, v2 — and not a
 * row version, so it is never passed as `expectedVersion`: the transition
 * would increment it and renumber the budget.
 *
 * Deciding a budget is Finance's approval authority rather than the record's
 * own: either the module-wide `finance.approval.decide` or the budget's own
 * approve or reject grant, as `canApproveType` and `canRejectType` answer it.
 * Returning for revision is a rejection that sends the budget back to `DRAFT`
 * for a new cycle, so it takes the reject grant. The service also checks, above
 * the write, that a cycle is pending and that nobody decides their own
 * submission.
 *
 * Nothing moves a `REJECTED` budget back to `DRAFT`: it is corrected where it
 * stands and submitted again.
 *
 * Archiving has a second condition the table cannot express — the current
 * budget is never archived — and restoring one has another, that the project
 * has no other open version; the service checks both (PRD #15 §110, §116).
 */
export type ProjectBudgetTransitionAction = "submit" | "approve" | "reject" | "return" | "archive" | "restore";

const ARCHIVABLE: BudgetStatus[] = ["DRAFT", "REJECTED"];

export const projectBudgetMachine = defineStateMachine<BudgetStatus, ProjectBudgetTransitionAction>({
  key: "project_budget",
  model: "projectBudget",
  field: "status",
  states: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "ARCHIVED"],
  terminal: ["APPROVED"],
  transitions: [
    { action: "submit", from: ["DRAFT", "REJECTED"], to: "PENDING_APPROVAL", permission: "finance.budget.submit" },
    { action: "approve", from: ["PENDING_APPROVAL"], to: "APPROVED", permission: ["finance.approval.decide", "finance.budget.approve"], freezes: "the whole version — a change is the next version" },
    { action: "reject", from: ["PENDING_APPROVAL"], to: "REJECTED", permission: ["finance.approval.decide", "finance.budget.reject"], requiresReason: true },
    { action: "return", from: ["PENDING_APPROVAL"], to: "DRAFT", permission: ["finance.approval.decide", "finance.budget.reject"], requiresReason: true },
    { action: "archive", from: ARCHIVABLE, to: "ARCHIVED", permission: "finance.budget.archive" },
    { action: "restore", from: ["ARCHIVED"], to: ARCHIVABLE, permission: "finance.budget.restore" },
  ],
});
